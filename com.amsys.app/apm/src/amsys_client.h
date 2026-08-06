#ifndef AMSYS_CLIENT_H
#define AMSYS_CLIENT_H

#include <string>
#include <windows.h>

namespace apm {

// Client for communicating with amsys.exe --pipe (JSON-Lines protocol).
// RAII: constructor spawns amsys, destructor kills it.
class AmsysClient {
public:
    // Launch amsys.exe --pipe.  If amsys_path is empty, searches PATH.
    explicit AmsysClient(const std::string& amsys_path = "");
    ~AmsysClient();

    // Non-copyable
    AmsysClient(const AmsysClient&) = delete;
    AmsysClient& operator=(const AmsysClient&) = delete;

    // Moveable
    AmsysClient(AmsysClient&& other) noexcept;
    AmsysClient& operator=(AmsysClient&& other) noexcept;

    // Returns true if the subprocess is alive
    bool alive() const { return proc_info_.hProcess != nullptr; }

    // Resolve a Unix path → Windows absolute path.
    // Calls `resolve <unix_path>` and returns winPath (empty on failure).
    std::string resolve(const std::string& unix_path);

    // Calls `to_windows <unix_path>` and returns winPath (empty on failure).
    std::string to_windows(const std::string& unix_path);

    // Close pipe handles and kill the subprocess.
    void close();

private:
    std::string send_command(const std::string& cmd);

    PROCESS_INFORMATION proc_info_;
    HANDLE h_stdin_write_;   // write end of stdin pipe (we write to amsys)
    HANDLE h_stdout_read_;   // read end of stdout pipe (we read from amsys)

    // Overlapped I/O state for reading
    OVERLAPPED ov_read_;
    char read_buf_[4096];
    std::string read_buffer_; // partial data between reads
    bool ov_pending_;
};

} // namespace apm

#endif // AMSYS_CLIENT_H
