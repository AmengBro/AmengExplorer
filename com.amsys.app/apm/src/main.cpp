#include "installer.h"

#include <cstdio>
#include <iostream>
#include <string>
#include <vector>
#include <windows.h>

static void print_usage() {
    std::cout << "apm — Amsys Package Manager\n"
              << "Usage:\n"
              << "  apm install <package.aup>   Install a package\n"
              << "  apm uninstall <name>         Uninstall a package\n"
              << "  apm list                     List installed packages\n"
              << "  apm --help                   Show this help\n"
              << "This APM have super cow powers.\n";
}

// The classic Debian "apt-get moo" easter egg, amsys-style.
static void print_moo(bool verbose) {
    std::cout <<
"                  (__)\n"
"                  (oo)\n"
"            /------\\/\n"
"           / |     ||\n"
"          *  /\\---/\\\n"
"             ~~   ~~\n";
    if (verbose) {
        std::cout << "...\"This APM has Super Cow Powers.\" (超级牛力)...\n";
    } else {
        std::cout << "...\"Have you mooed today?\"...\n";
    }
    std::cout << std::endl;
}

// Mirror amsys find_config_path(): does this amsys.exe have a reachable
// config.ini (exe dir, parent dir, or current cwd)?
static bool amsys_can_load_config(const std::string& exe_path) {
    std::string exe_dir = exe_path;
    auto p = exe_dir.find_last_of("\\/");
    if (p != std::string::npos) exe_dir = exe_dir.substr(0, p);

    if (GetFileAttributesA((exe_dir + "\\config.ini").c_str()) != INVALID_FILE_ATTRIBUTES)
        return true;
    if (GetFileAttributesA((exe_dir + "\\..\\config.ini").c_str()) != INVALID_FILE_ATTRIBUTES)
        return true;
    if (GetFileAttributesA("config.ini") != INVALID_FILE_ATTRIBUTES)
        return true;
    return false;
}

static std::string find_amsys() {
    char own[MAX_PATH];
    GetModuleFileNameA(nullptr, own, MAX_PATH);
    std::string dir(own);
    auto pos = dir.find_last_of("\\/");
    if (pos == std::string::npos) return "amsys.exe";
    dir = dir.substr(0, pos);

    // Candidates: same dir as apm.exe, then ..\ , ..\..\ (project root), then PATH
    std::vector<std::string> cands;
    for (int up = 0; up <= 2; up++) {
        std::string base = dir;
        for (int i = 0; i < up; i++) base += "\\..";
        cands.push_back(base + "\\amsys.exe");
    }
    cands.push_back("amsys.exe");

    // Prefer a candidate that can actually load config.ini (correct root)
    for (auto& c : cands) {
        if (GetFileAttributesA(c.c_str()) != INVALID_FILE_ATTRIBUTES &&
            amsys_can_load_config(c))
            return c;
    }
    // Fallback: first existing candidate
    for (auto& c : cands) {
        if (GetFileAttributesA(c.c_str()) != INVALID_FILE_ATTRIBUTES)
            return c;
    }
    return "amsys.exe";
}

int main(int argc, char* argv[]) {
    // UTF-8 console
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    if (argc < 2) {
        print_usage();
        return 1;
    }

    std::string cmd = argv[1];

    if (cmd == "--help" || cmd == "-h") {
        print_usage();
        return 0;
    }

    if (cmd == "install") {
        if (argc < 3) {
            std::cerr << "error: missing package file\n";
            return 1;
        }

        std::string package_path = argv[2];
        std::string amsys_path = find_amsys();

        auto result = apm::install_package(package_path, amsys_path);

        if (result.success) {
            std::cout << "[apm] ok: " << result.message << std::endl;
            return 0;
        } else {
            std::cerr << "[apm] error: " << result.message << std::endl;
            return 1;
        }
    }

    if (cmd == "uninstall") {
        if (argc < 3) {
            std::cerr << "error: missing package name\n";
            return 1;
        }

        std::string pkg_name = argv[2];
        std::string amsys_path = find_amsys();
        auto result = apm::uninstall_package(pkg_name, amsys_path);

        if (result.success) {
            std::cout << "[apm] ok: " << result.message << std::endl;
            return 0;
        } else {
            std::cerr << "[apm] error: " << result.message << std::endl;
            return 1;
        }
    }

    if (cmd == "list") {
        std::string amsys_path = find_amsys();
        auto result = apm::list_packages(amsys_path);

        if (result.success) {
            std::cout << "[apm] " << result.message << std::endl;
            return 0;
        } else {
            std::cout << "[apm] " << result.message << std::endl;
            return 0;
        }
    }

    if (cmd == "moo") {
        // Easter egg: moo -v shows Super Cow Powers
        bool verbose = (argc >= 3) &&
                       (std::string(argv[2]) == "-v" || std::string(argv[2]) == "--verbose");
        print_moo(verbose);
        return 0;
    }

    std::cerr << "error: unknown command '" << cmd << "'\n";
    print_usage();
    return 1;
}
