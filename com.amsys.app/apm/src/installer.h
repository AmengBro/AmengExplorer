#ifndef AMSYS_INSTALLER_H
#define AMSYS_INSTALLER_H

#include <string>
#include <vector>

namespace apm {

class AmsysClient;  // forward decl — used in detail::install_app_file

struct PackageInfo {
    std::string name;       // from [package] name
    std::string version;    // from [package] version
    std::string location;   // from [install] location (/opt or /bin)
    std::string dir_name;   // from [install] name
};

struct InstallResult {
    bool success = false;
    std::string message;
};

// Install a .aup package.
// package_path: Windows path to the .aup file (e.g. "C:\downloads\myapp.aup")
// amsys_path:   path to amsys.exe (empty = search PATH)
InstallResult install_package(const std::string& package_path,
                              const std::string& amsys_path = "");

// Uninstall a package by name.
// Reads /etc/{name}/aminfo.ini to find install location, then removes files.
// amsys_path: path to amsys.exe (empty = search PATH)
InstallResult uninstall_package(const std::string& package_name,
                                const std::string& amsys_path = "");

// List installed packages.
// Reads /etc/apmlist and displays name + version per package.
// amsys_path: path to amsys.exe (empty = search PATH)
InstallResult list_packages(const std::string& amsys_path = "");

namespace detail {

// Create directory recursively (Windows). Returns true if exists/created.
bool ensure_dir(const std::string& path);

// Recursively copy src_dir to dst_dir (Windows paths).
bool copy_directory(const std::string& src_dir, const std::string& dst_dir);

// Recursively delete a directory.
bool remove_directory(const std::string& path);

// Read and update .app JSON: replace Unix paths with Windows paths via amsys,
// then write the result directly to dst_path.
// Uses the existing AmsysClient (no new process spawned).
bool install_app_file(AmsysClient& amsys,
                      const std::string& src_path,
                      const std::string& dst_path);

// Run 7z to extract archive. Returns true on success.
bool extract_archive(const std::string& sevenz_path,
                     const std::string& archive_path,
                     const std::string& output_dir);

// Read and parse aminfo.ini from a directory.
bool read_aminfo(const std::string& dir, PackageInfo& info);

} // namespace detail

} // namespace apm

#endif // AMSYS_INSTALLER_H
