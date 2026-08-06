#define _WIN32_WINNT 0x0600
#include "amsys_client.h"
#include <cstdio>
#include <sstream>
#include <cstring>
#include <memory>

namespace apm {

// ── helpers ────────────────────────────────────────

static std::string find_amsys(const std::string& hint) {
    if (!hint.empty()) return hint;

    // Search: same directory as this exe, then PATH
    char own_exe[MAX_PATH];
    GetModuleFileNameA(nullptr, own_exe, MAX_PATH);
    std::string dir(own_exe);
    auto pos = dir.find_last_of("\\/");
    if (pos != std::string::npos) {
        dir = dir.substr(0, pos);
        std::string candidate = dir + "\\amsys.exe";
        // Check if exists
        if (GetFileAttributesA(candidate.c_str()) != INVALID_FILE_ATTRIBUTES)
            return candidate;
    }

    // PATH search — just return bare name and let CreateProcess find it
    return "amsys.exe";
}

static std::string extract_winpath(const std::string& json) {
    // Minimal JSON extractor: find "winPath":"<value>"
    // We know the exact format from amsys --pipe protocol.
    const std::string marker = "\"winPath\":\"";
    auto p = json.find(marker);
    if (p == std::string::npos) return {};

    p += marker.size();
    std::string val;
    bool escape = false;
    for (; p < json.size(); p++) {
        char c = json[p];
        if (escape) {
            if (c == '\\' || c == '"') val += c;
            else if (c == 'n') val += '\n';
            else if (c == 'r') val += '\r';
            else if (c == 't') val += '\t';
            else val += c;
            escape = false;
        } else if (c == '\\') {
            escape = true;
        } else if (c == '"') {
            break;
        } else {
            val += c;
        }
    }
    return val;
}

static bool json_success(const std::string& json) {
    // Check for "success":true
    return json.find("\"success\":true") != std::string::npos ||
           json.find("\"success\": true") != std::string::npos;
}

// ── construction / destruction ─────────────────────

AmsysClient::AmsysClient(const std::string& amsys_path)
    : proc_info_{}
    , h_stdin_write_(INVALID_HANDLE_VALUE)
    , h_stdout_read_(INVALID_HANDLE_VALUE)
    , ov_read_{}
    , read_buf_{}
    , ov_pending_(false)
{
    std::string path = find_amsys(amsys_path);

    // Create pipes for stdin/stdout
    HANDLE h_stdin_read  = INVALID_HANDLE_VALUE;  // child reads from this
    HANDLE h_stdout_write = INVALID_HANDLE_VALUE; // child writes to this

    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = nullptr;
    sa.bInheritHandle = TRUE;

    // Child stdin pipe
    if (!CreatePipe(&h_stdin_read, &h_stdin_write_, &sa, 0))
        return;
    // Child stdout pipe
    if (!CreatePipe(&h_stdout_read_, &h_stdout_write, &sa, 0)) {
        CloseHandle(h_stdin_read);
        CloseHandle(h_stdin_write_);
        h_stdin_write_ = INVALID_HANDLE_VALUE;
        return;
    }

    // Ensure child ends are inheritable (they already are via sa)
    // Ensure parent ends are NOT inheritable
    SetHandleInformation(h_stdin_write_, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(h_stdout_read_, HANDLE_FLAG_INHERIT, 0);

    // Set up startup info
    STARTUPINFOA si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput  = h_stdin_read;
    si.hStdOutput = h_stdout_write;
    si.hStdError  = GetStdHandle(STD_ERROR_HANDLE); // inherit our stderr

    // Build command line
    std::string cmdline = "\"" + path + "\" --pipe";

    BOOL ok = CreateProcessA(
        nullptr,                   // app name
        &cmdline[0],               // command line (mutable)
        nullptr,                   // process attr
        nullptr,                   // thread attr
        TRUE,                      // inherit handles
        0,                         // flags
        nullptr,                   // env
        nullptr,                   // cwd
        &si,
        &proc_info_
    );

    // Close child ends (we no longer need them)
    CloseHandle(h_stdin_read);
    CloseHandle(h_stdout_write);

    if (!ok) {
        CloseHandle(h_stdin_write_);
        CloseHandle(h_stdout_read_);
        h_stdin_write_ = INVALID_HANDLE_VALUE;
        h_stdout_read_ = INVALID_HANDLE_VALUE;
        return;
    }

    // Prepare overlapped read
    ZeroMemory(&ov_read_, sizeof(ov_read_));
    ov_read_.hEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);
    ov_pending_ = false;

    // Give amsys a moment to initialize
    WaitForInputIdle(proc_info_.hProcess, 1000);
}

AmsysClient::~AmsysClient() {
    close();
}

AmsysClient::AmsysClient(AmsysClient&& other) noexcept
    : proc_info_(other.proc_info_)
    , h_stdin_write_(other.h_stdin_write_)
    , h_stdout_read_(other.h_stdout_read_)
    , ov_read_(other.ov_read_)
    , read_buf_{}
    , read_buffer_(std::move(other.read_buffer_))
    , ov_pending_(other.ov_pending_)
{
    memcpy(read_buf_, other.read_buf_, sizeof(read_buf_));
    ZeroMemory(&other.proc_info_, sizeof(other.proc_info_));
    other.h_stdin_write_ = INVALID_HANDLE_VALUE;
    other.h_stdout_read_ = INVALID_HANDLE_VALUE;
    other.ov_pending_ = false;
    ZeroMemory(&other.ov_read_, sizeof(other.ov_read_));
}

AmsysClient& AmsysClient::operator=(AmsysClient&& other) noexcept {
    if (this != &other) {
        close();
        proc_info_ = other.proc_info_;
        h_stdin_write_ = other.h_stdin_write_;
        h_stdout_read_ = other.h_stdout_read_;
        ov_read_ = other.ov_read_;
        memcpy(read_buf_, other.read_buf_, sizeof(read_buf_));
        read_buffer_ = std::move(other.read_buffer_);
        ov_pending_ = other.ov_pending_;
        ZeroMemory(&other.proc_info_, sizeof(other.proc_info_));
        other.h_stdin_write_ = INVALID_HANDLE_VALUE;
        other.h_stdout_read_ = INVALID_HANDLE_VALUE;
        other.ov_pending_ = false;
        ZeroMemory(&other.ov_read_, sizeof(other.ov_read_));
    }
    return *this;
}

void AmsysClient::close() {
    // Cancel pending IO
    if (h_stdout_read_ != INVALID_HANDLE_VALUE) {
        CancelIoEx(h_stdout_read_, &ov_read_);
    }

    if (ov_read_.hEvent) {
        CloseHandle(ov_read_.hEvent);
        ov_read_.hEvent = nullptr;
    }

    if (h_stdin_write_ != INVALID_HANDLE_VALUE) {
        CloseHandle(h_stdin_write_);
        h_stdin_write_ = INVALID_HANDLE_VALUE;
    }
    if (h_stdout_read_ != INVALID_HANDLE_VALUE) {
        CloseHandle(h_stdout_read_);
        h_stdout_read_ = INVALID_HANDLE_VALUE;
    }
    if (proc_info_.hProcess) {
        // Give it a chance to exit cleanly
        WaitForSingleObject(proc_info_.hProcess, 500);
        TerminateProcess(proc_info_.hProcess, 1);
        CloseHandle(proc_info_.hProcess);
        CloseHandle(proc_info_.hThread);
        ZeroMemory(&proc_info_, sizeof(proc_info_));
    }
}

// ── command execution ──────────────────────────────

std::string AmsysClient::send_command(const std::string& cmd) {
    if (h_stdin_write_ == INVALID_HANDLE_VALUE || h_stdout_read_ == INVALID_HANDLE_VALUE)
        return "{\"success\":false}";

    // Write command + newline
    std::string full_cmd = cmd + "\n";
    DWORD written;
    if (!WriteFile(h_stdin_write_, full_cmd.data(), (DWORD)full_cmd.size(), &written, nullptr))
        return "{\"success\":false}";

    // Read response line (up to newline)
    std::string response;
    while (true) {
        // First check if we have a complete line in the buffer
        auto nl = read_buffer_.find('\n');
        if (nl != std::string::npos) {
            response = read_buffer_.substr(0, nl);
            // Remove trailing \r if present
            if (!response.empty() && response.back() == '\r')
                response.pop_back();
            read_buffer_ = read_buffer_.substr(nl + 1);
            break;
        }

        // Read more data
        DWORD bytes_read = 0;
        if (!ov_pending_) {
            ZeroMemory(&ov_read_, sizeof(ov_read_));
            ov_read_.hEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);
            BOOL ok = ReadFile(h_stdout_read_, read_buf_, sizeof(read_buf_) - 1, &bytes_read, &ov_read_);
            if (!ok && GetLastError() == ERROR_IO_PENDING) {
                ov_pending_ = true;
            } else if (ok) {
                // Completed synchronously
                read_buf_[bytes_read] = '\0';
                read_buffer_ += read_buf_;
                continue;
            } else {
                break;
            }
        }

        // Wait for overlapped IO to complete
        if (ov_pending_) {
            if (WaitForSingleObject(ov_read_.hEvent, 5000) == WAIT_OBJECT_0) {
                if (GetOverlappedResult(h_stdout_read_, &ov_read_, &bytes_read, FALSE)) {
                    read_buf_[bytes_read] = '\0';
                    read_buffer_ += read_buf_;
                }
                ov_pending_ = false;
            } else {
                // Timeout — cancel and bail
                CancelIoEx(h_stdout_read_, &ov_read_);
                ov_pending_ = false;
                break;
            }
        }
    }

    return response;
}

std::string AmsysClient::resolve(const std::string& unix_path) {
    std::string json = send_command("resolve " + unix_path);
    if (!json_success(json)) return {};
    return extract_winpath(json);
}

std::string AmsysClient::to_windows(const std::string& unix_path) {
    std::string json = send_command("to_windows " + unix_path);
    if (!json_success(json)) return {};
    return extract_winpath(json);
}

} // namespace apm
