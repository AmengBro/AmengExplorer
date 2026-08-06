#define _WIN32_WINNT 0x0600
#include "installer.h"
#include "ini_parser.h"
#include "amsys_client.h"

#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <vector>
#include <sys/stat.h>

#include <windows.h>
#include <shellapi.h>

namespace apm {

// ── permission helper ──────────────────────────────

static std::string permission_hint() {
    DWORD err = GetLastError();
    if (err == ERROR_ACCESS_DENIED || err == ERROR_WRITE_PROTECT)
        return " — apm needs sudo permission (run as Administrator)";
    return "";
}

// ── apmlist helpers ────────────────────────────────

// Resolve /etc/apmlist to a Windows path.  Returns empty on failure.
static std::string apmlist_path(AmsysClient& amsys) {
    std::string win = amsys.resolve("/etc/apmlist");
    if (win.empty()) {
        std::string etc_win = amsys.resolve("/etc");
        if (!etc_win.empty())
            win = etc_win + "\\apmlist";
    }
    return win;
}

// Append package name to /etc/apmlist (one name per line).
static void apmlist_append(AmsysClient& amsys, const std::string& name) {
    std::string list_win = apmlist_path(amsys);
    if (list_win.empty()) return;

    std::vector<std::string> names;
    std::ifstream in(list_win);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty() && line != name)
            names.push_back(line);
    }
    in.close();
    names.push_back(name);

    std::ofstream out(list_win);
    for (auto& n : names) out << n << "\n";
}

// Remove package name from /etc/apmlist.
static void apmlist_remove(AmsysClient& amsys, const std::string& name) {
    std::string list_win = apmlist_path(amsys);
    if (list_win.empty()) return;

    std::vector<std::string> names;
    std::ifstream in(list_win);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty() && line != name)
            names.push_back(line);
    }
    in.close();

    std::ofstream out(list_win);
    for (auto& n : names) out << n << "\n";
}

// ── helpers ────────────────────────────────────────

bool detail::ensure_dir(const std::string& path) {
    if (CreateDirectoryA(path.c_str(), nullptr)) return true;
    DWORD err = GetLastError();
    if (err == ERROR_ALREADY_EXISTS) return true;

    std::string parent = path;
    auto pos = parent.find_last_of("\\/");
    if (pos != std::string::npos) {
        parent = parent.substr(0, pos);
        if (ensure_dir(parent)) {
            if (CreateDirectoryA(path.c_str(), nullptr)) return true;
            if (GetLastError() == ERROR_ALREADY_EXISTS) return true;
        }
    }
    return false;
}

bool detail::copy_directory(const std::string& src, const std::string& dst) {
    if (!ensure_dir(dst)) return false;

    std::string src_wild = src + "\\*";
    WIN32_FIND_DATAA ffd;
    HANDLE hFind = FindFirstFileA(src_wild.c_str(), &ffd);
    if (hFind == INVALID_HANDLE_VALUE) return false;

    do {
        std::string name = ffd.cFileName;
        if (name == "." || name == "..") continue;

        std::string src_path = src + "\\" + name;
        std::string dst_path = dst + "\\" + name;

        if (ffd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!copy_directory(src_path, dst_path)) {
                FindClose(hFind);
                return false;
            }
        } else {
            if (!CopyFileA(src_path.c_str(), dst_path.c_str(), FALSE)) {
                FindClose(hFind);
                return false;
            }
        }
    } while (FindNextFileA(hFind, &ffd));

    FindClose(hFind);
    return true;
}

bool detail::remove_directory(const std::string& path) {
    SHFILEOPSTRUCTA op;
    ZeroMemory(&op, sizeof(op));
    op.wFunc = FO_DELETE;
    std::string p = path;
    p.push_back('\0');
    p.push_back('\0');
    op.pFrom = p.data();
    op.fFlags = FOF_NO_UI | FOF_SILENT | FOF_NOCONFIRMATION;
    return SHFileOperationA(&op) == 0;
}

bool detail::extract_archive(const std::string& sevenz_path,
                              const std::string& archive_path,
                              const std::string& output_dir)
{
    std::string actual_7z = sevenz_path;
    DWORD attrs = GetFileAttributesA(sevenz_path.c_str());
    if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
        actual_7z = sevenz_path + "\\7z.exe";
    }

    std::string cmd = "\"" + actual_7z + "\" x \"" + archive_path +
                      "\" -o\"" + output_dir + "\" -y";

    STARTUPINFOA si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput  = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    si.hStdError  = GetStdHandle(STD_ERROR_HANDLE);

    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    std::string mutable_cmd = cmd;
    BOOL ok = CreateProcessA(nullptr, &mutable_cmd[0],
                             nullptr, nullptr, TRUE,
                             CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    if (!ok) return false;

    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return exit_code == 0;
}

bool detail::read_aminfo(const std::string& dir, PackageInfo& info) {
    std::string ini_path = dir + "\\aminfo.ini";
    IniParser ini;
    if (!ini.load(ini_path)) return false;

    info.name = ini.get("package", "name");
    info.version = ini.get("package", "version");
    info.location = ini.get("install", "location");
    info.dir_name = ini.get("install", "name");

    if (info.name.empty() || info.dir_name.empty()) return false;
    if (info.location != "/opt" && info.location != "/bin") return false;

    return true;
}

bool detail::install_app_file(AmsysClient& amsys,
                               const std::string& src_path,
                               const std::string& dst_path)
{
    std::ifstream f(src_path);
    if (!f.is_open()) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    std::string json = ss.str();
    f.close();

    // Convert Unix paths in exePath and icon fields to Windows paths
    // via the existing AmsysClient (no new process spawned).
    auto convert_field = [&](const std::string& field_name) -> bool {
        // Search for "fieldName": then skip colon, whitespace, and opening quote
        std::string search = "\"" + field_name + "\":";
        size_t pos = 0;
        bool changed = false;
        while ((pos = json.find(search, pos)) != std::string::npos) {
            pos += search.size(); // position past ":"
            // Skip any whitespace between colon and value
            while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t'))
                pos++;
            if (pos >= json.size() || json[pos] != '"') break;
            pos++; // skip opening quote
            size_t end = json.find('"', pos);
            if (end == std::string::npos) break;
            std::string unix_val = json.substr(pos, end - pos);

            // Unescape JSON escapes (e.g. \\ → \\, \/ → /)
            std::string unescaped;
            for (size_t i = 0; i < unix_val.size(); i++) {
                if (unix_val[i] == '\\' && i + 1 < unix_val.size()) {
                    char n = unix_val[i + 1];
                    if (n == '\\') unescaped += '\\';
                    else if (n == '"') unescaped += '"';
                    else if (n == '/') unescaped += '/';
                    else { unescaped += unix_val[i]; unescaped += n; }
                    i++;
                } else {
                    unescaped += unix_val[i];
                }
            }
            unix_val = unescaped;

            if (!unix_val.empty() && unix_val[0] == '/') {
                std::string win_val = amsys.to_windows(unix_val);
                if (!win_val.empty()) {
                    // Escape backslashes for JSON output
                    std::string escaped;
                    for (char c : win_val) {
                        if (c == '\\') escaped += "\\\\";
                        else escaped += c;
                    }
                    json = json.substr(0, pos) + escaped + json.substr(end);
                    pos = pos + escaped.size();
                    changed = true;
                }
            }
        }
        return changed;
    };

    convert_field("exePath");
    convert_field("icon");

    // Write result directly to destination
    std::ofstream of(dst_path);
    if (!of.is_open()) return false;
    of << json;
    return true;
}

// ── main install function ──────────────────────────

InstallResult install_package(const std::string& package_path,
                               const std::string& amsys_path)
{
    InstallResult result;

    // ── 1. Start amsys ──
    AmsysClient amsys(amsys_path);
    if (!amsys.alive()) {
        result.message = "failed to start amsys.exe --pipe";
        return result;
    }

    // ── 2. Resolve paths ──
    std::string tmp_win = amsys.resolve("/tmp");
    if (tmp_win.empty()) {
        result.message = "failed to resolve /tmp";
        return result;
    }

    std::string sevenz_win = amsys.resolve("/bin/7z/7z.exe");
    if (sevenz_win.empty()) {
        result.message = "failed to resolve /bin/7z/7z.exe";
        return result;
    }

    // ── 2b. Normalize package path to a Windows absolute path ──
    //     - /media/... (Unix absolute)  → amsys resolve
    //     - D:\... / \\server\...        → as-is
    //     - ./x.aup / x.aup (relative)  → GetFullPathNameA (cwd = shell cwd)
    std::string abs_pkg = package_path;
    if (package_path.empty()) {
        result.message = "empty package path";
        return result;
    } else if (package_path[0] == '/') {
        // Unix-style path — translate through amsys
        abs_pkg = amsys.resolve(package_path);
        if (abs_pkg.empty()) {
            result.message = "cannot resolve package path: " + package_path;
            return result;
        }
    } else if (package_path.size() >= 2 && package_path[1] == ':' &&
               isalpha((unsigned char)package_path[0])) {
        // Windows drive path — as-is
        abs_pkg = package_path;
    } else {
        // Relative / bare name — absolutize against cwd (inherited from shell)
        char buf[MAX_PATH];
        DWORD n = GetFullPathNameA(package_path.c_str(), MAX_PATH, buf, nullptr);
        if (n == 0 || n >= MAX_PATH) {
            result.message = "cannot resolve package path: " + package_path;
            return result;
        }
        abs_pkg = buf;
    }

    // Verify the normalized package file exists
    if (GetFileAttributesA(abs_pkg.c_str()) == INVALID_FILE_ATTRIBUTES) {
        result.message = "file not found: " + package_path;
        return result;
    }

    // ── 3. Extract to /tmp/apmtemp ──
    std::string tmp_dir = tmp_win + "\\apmtemp";
    std::cout << "[apm] extracting " << abs_pkg << " to " << tmp_dir << std::endl;

    if (detail::ensure_dir(tmp_dir)) {
        detail::remove_directory(tmp_dir);
        detail::ensure_dir(tmp_dir);
    }

    if (!detail::extract_archive(sevenz_win, abs_pkg, tmp_dir)) {
        detail::remove_directory(tmp_dir);
        result.message = "failed to extract package with 7z" + permission_hint();
        return result;
    }

    // ── 4. Read aminfo.ini ──
    PackageInfo info;
    if (!detail::read_aminfo(tmp_dir, info)) {
        detail::remove_directory(tmp_dir);
        result.message = "invalid or missing aminfo.ini";
        return result;
    }

    std::cout << "[apm] package: " << info.name
              << " v" << info.version
              << " → " << info.location << "/" << info.dir_name << std::endl;

    // ── 5. Resolve install target ──
    std::string install_unix = info.location + "/" + info.dir_name;
    std::string install_win = amsys.resolve(install_unix);
    if (install_win.empty()) {
        std::string loc_win = amsys.resolve(info.location);
        if (!loc_win.empty()) {
            install_win = loc_win + "\\" + info.dir_name;
        } else {
            detail::remove_directory(tmp_dir);
            result.message = "failed to resolve install location " + info.location;
            return result;
        }
    }

    // ── 6. Install .app to /usr/share/applications FIRST ──
    //     Scan for ALL *.app files in the package (don't rely on name+.app)
    {
        std::string usr_win = amsys.resolve("/usr");
        bool usr_ok = !usr_win.empty();

        WIN32_FIND_DATAA ffd;
        std::string app_pattern = tmp_dir + "\\*.app";
        HANDLE hFind = FindFirstFileA(app_pattern.c_str(), &ffd);
        if (hFind != INVALID_HANDLE_VALUE) {
            do {
                std::string app_name = ffd.cFileName;
                if (app_name == "." || app_name == "..") continue;

                std::string src_path = tmp_dir + "\\" + app_name;

                if (!usr_ok) {
                    std::cout << "[apm] warning: cannot resolve /usr, skipping "
                              << app_name << std::endl;
                } else {
                    std::string apps_win = usr_win + "\\share\\applications";
                    std::string dst_path = apps_win + "\\" + app_name;

                    if (!detail::ensure_dir(apps_win)) {
                        std::cout << "[apm] warning: cannot create /usr/share/applications"
                                  << permission_hint() << ", skipping " << app_name << std::endl;
                    } else if (detail::install_app_file(amsys, src_path, dst_path)) {
                        std::cout << "[apm] installed " << app_name
                                  << " to /usr/share/applications" << std::endl;
                    } else if (CopyFileA(src_path.c_str(), dst_path.c_str(), FALSE)) {
                        std::cout << "[apm] copied (unprocessed) " << app_name
                                  << " to /usr/share/applications" << std::endl;
                    } else {
                        std::cout << "[apm] warning: failed to copy "
                                  << "/usr/share/applications/" << app_name
                                  << permission_hint() << std::endl;
                    }
                }
            } while (FindNextFileA(hFind, &ffd));
            FindClose(hFind);
        }
    }

    // ── 7. Copy files to install dir ──
    std::cout << "[apm] installing to " << install_win << std::endl;
    if (!detail::ensure_dir(install_win)) {
        detail::remove_directory(tmp_dir);
        result.message = "failed to create " + install_win + permission_hint();
        return result;
    }

    if (!detail::copy_directory(tmp_dir, install_win)) {
        detail::remove_directory(tmp_dir);
        result.message = "failed to copy files to " + install_win + permission_hint();
        return result;
    }

    // Remove aminfo.ini and all .app files from install dir (they belong elsewhere)
    DeleteFileA((install_win + "\\aminfo.ini").c_str());
    {
        WIN32_FIND_DATAA ffd;
        std::string app_pattern = install_win + "\\*.app";
        HANDLE hFind = FindFirstFileA(app_pattern.c_str(), &ffd);
        if (hFind != INVALID_HANDLE_VALUE) {
            do {
                std::string name = ffd.cFileName;
                if (name == "." || name == "..") continue;
                DeleteFileA((install_win + "\\" + name).c_str());
            } while (FindNextFileA(hFind, &ffd));
            FindClose(hFind);
        }
    }

    // ── 8. Save aminfo.ini to /etc/{name} for future uninstall ──
    std::string etc_record_unix = "/etc/" + info.name;
    std::string etc_record_win = amsys.resolve(etc_record_unix);
    if (etc_record_win.empty()) {
        std::string etc_win = amsys.resolve("/etc");
        if (!etc_win.empty())
            etc_record_win = etc_win + "\\" + info.name;
    }
    if (!etc_record_win.empty()) {
        detail::ensure_dir(etc_record_win);
        if (CopyFileA((tmp_dir + "\\aminfo.ini").c_str(),
                      (etc_record_win + "\\aminfo.ini").c_str(), FALSE)) {
            std::cout << "[apm] saved install record to "
                      << etc_record_unix << "/aminfo.ini" << std::endl;
        }
    }

    // ── 9. Register in /etc/apmlist ──
    apmlist_append(amsys, info.name);

    // ── 10. Cleanup ──
    detail::remove_directory(tmp_dir);

    result.success = true;
    result.message = "installed " + info.name + " v" + info.version +
                     " to " + install_unix;
    return result;
}

// ── uninstall ──────────────────────────────────────

InstallResult uninstall_package(const std::string& package_name,
                                 const std::string& amsys_path)
{
    InstallResult result;

    AmsysClient amsys(amsys_path);
    if (!amsys.alive()) {
        result.message = "failed to start amsys.exe --pipe";
        return result;
    }

    std::string record_unix = "/etc/" + package_name;
    std::string record_win = amsys.resolve(record_unix);
    if (record_win.empty()) {
        std::string etc_win = amsys.resolve("/etc");
        if (!etc_win.empty()) {
            record_win = etc_win + "\\" + package_name;
        }
    }

    if (record_win.empty() ||
        GetFileAttributesA((record_win + "\\aminfo.ini").c_str()) == INVALID_FILE_ATTRIBUTES) {
        result.message = "package '" + package_name + "' is not installed (no install record found)";
        return result;
    }

    PackageInfo info;
    if (!detail::read_aminfo(record_win, info)) {
        result.message = "corrupt install record at " + record_unix + "/aminfo.ini";
        return result;
    }

    std::cout << "[apm] package: " << info.name
              << " v" << info.version
              << " (installed at " << info.location << "/" << info.dir_name << ")" << std::endl;

    std::string install_unix = info.location + "/" + info.dir_name;
    std::string install_win = amsys.resolve(install_unix);
    if (install_win.empty()) {
        std::string loc_win = amsys.resolve(info.location);
        if (!loc_win.empty()) {
            install_win = loc_win + "\\" + info.dir_name;
        }
    }

    if (!install_win.empty()) {
        std::cout << "[apm] removing " << install_unix << " ..." << std::endl;
        if (!detail::remove_directory(install_win)) {
            DWORD err = GetLastError();
            if (err == ERROR_ACCESS_DENIED || err == ERROR_WRITE_PROTECT) {
                result.message = "cannot remove " + install_unix +
                                 " — apm needs sudo permission (run as Administrator)";
                return result;
            }
        }
    } else {
        std::cout << "[apm] warning: cannot resolve " << install_unix << ", skipping" << std::endl;
    }

    // Scan for *.app files matching this package and delete them
    std::string apps_win;
    std::string usr_win = amsys.resolve("/usr");
    if (!usr_win.empty()) {
        apps_win = usr_win + "\\share\\applications";
    }

    if (!apps_win.empty()) {
        std::string pattern = apps_win + "\\*.app";
        WIN32_FIND_DATAA ffd;
        HANDLE hFind = FindFirstFileA(pattern.c_str(), &ffd);
        if (hFind != INVALID_HANDLE_VALUE) {
            do {
                std::string name = ffd.cFileName;
                if (name == "." || name == "..") continue;
                if (name == info.name + ".app" ||
                    name.find(info.name) == 0) {
                    if (DeleteFileA((apps_win + "\\" + name).c_str())) {
                        std::cout << "[apm] removed /usr/share/applications/" << name << std::endl;
                    }
                }
            } while (FindNextFileA(hFind, &ffd));
            FindClose(hFind);
        }
    }

    if (!record_win.empty()) {
        detail::remove_directory(record_win);
        std::cout << "[apm] removed install record" << std::endl;
    }

    apmlist_remove(amsys, info.name);

    result.success = true;
    result.message = "uninstalled " + info.name + " v" + info.version;
    return result;
}

// ── list ────────────────────────────────────────

InstallResult list_packages(const std::string& amsys_path) {
    InstallResult result;

    AmsysClient amsys(amsys_path);
    if (!amsys.alive()) {
        result.message = "failed to start amsys.exe --pipe";
        return result;
    }

    std::string list_win = apmlist_path(amsys);
    if (list_win.empty()) {
        result.message = "no packages installed";
        return result;
    }

    std::ifstream in(list_win);
    if (!in.is_open()) {
        result.message = "no packages installed";
        return result;
    }

    std::vector<std::string> names;
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty())
            names.push_back(line);
    }
    in.close();

    if (names.empty()) {
        result.message = "no packages installed";
        return result;
    }

    std::cout << "Installed packages:" << std::endl;
    for (auto& name : names) {
        std::string etc_win = amsys.resolve("/etc/" + name);
        if (etc_win.empty()) {
            std::string etc_base = amsys.resolve("/etc");
            if (!etc_base.empty()) etc_win = etc_base + "\\" + name;
        }

        std::string version;
        if (!etc_win.empty()) {
            PackageInfo info;
            if (detail::read_aminfo(etc_win, info))
                version = info.version;
        }

        std::cout << "  " << name;
        if (!version.empty())
            std::cout << " v" << version;
        std::cout << std::endl;
    }

    result.success = true;
    result.message = std::to_string(names.size()) + " package(s) installed";
    return result;
}

} // namespace apm
