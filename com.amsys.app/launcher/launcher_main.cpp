// amsys login launcher
// 模仿 Linux tty 登录界面的启动器：
//   1. 读取用户名，检查 /etc/passwd 是否存在该用户
//   2. 从 /etc/shadow 读取该用户的密码哈希（裸 hex；无前缀默认 MD5，{SHA1} 前缀按 SHA-1）
//   3. 与输入密码比对，失败则报错重新输入
//   4. 成功则以 --user <username> 启动 amsys.exe
// 路径解析复用 amsys 的 Config + PathManager（config.ini 的 [system] root 虚拟根）。

#include <windows.h>
#include <conio.h>
#include <iostream>
#include <fstream>
#include <string>
#include <cstdio>
#include <cstring>

#include "config.h"
#include "path_manager.h"
#include "verify.h"
#include "passwd_shadow.h"

// ── Ctrl+C 处理 ──────────────────────────────────────
static volatile bool g_ctrl_c = false;

static BOOL WINAPI ctrl_handler(DWORD dwCtrlType) {
    if (dwCtrlType == CTRL_C_EVENT || dwCtrlType == CTRL_BREAK_EVENT) {
        g_ctrl_c = true;
        return TRUE; // 吞掉事件，由登录循环决定退出
    }
    return FALSE;
}

// ── 终端初始化 ───────────────────────────────────────
static void init_console() {
    SetConsoleCtrlHandler(ctrl_handler, TRUE);
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
    SetConsoleTitleA("amsys login");

    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    if (hOut != INVALID_HANDLE_VALUE) {
        DWORD mode = 0;
        if (GetConsoleMode(hOut, &mode)) {
            mode |= ENABLE_VIRTUAL_TERMINAL_PROCESSING;
            SetConsoleMode(hOut, mode);
        }
    }
}

// ── 不回显/回显输入（_getch 逐字符，兼容退格）────────
// 返回 false 表示用户按了 Ctrl+C
static bool read_line(std::string& out) {
    out.clear();
    while (true) {
        // _getch 会阻塞，先用 _kbhit 轮询以便响应 Ctrl+C
        while (!_kbhit()) {
            if (g_ctrl_c) return false;
            Sleep(20);
        }
        int ch = _getch();
        if (ch == 3 && g_ctrl_c) return false;          // Ctrl+C
        if (ch == '\r' || ch == '\n') { std::cout << "\r\n"; return true; }
        if (ch == 8 || ch == 127) {                     // Backspace
            if (!out.empty()) {
                out.pop_back();
                std::cout << "\b \b";
            }
        } else if (ch == 0 || ch == 0xE0) {
            _getch();                                   // 方向键等扩展键，丢弃
        } else if (ch >= 32) {
            out += static_cast<char>(ch);
            std::cout << static_cast<char>(ch);
        }
    }
}

// 密码输入：完全不回显（Linux getpass 风格，无星号）
static bool read_password(std::string& out) {
    out.clear();
    while (true) {
        // _getch 会阻塞，先用 _kbhit 轮询以便响应 Ctrl+C
        while (!_kbhit()) {
            if (g_ctrl_c) return false;
            Sleep(20);
        }
        int ch = _getch();
        if (ch == 3 && g_ctrl_c) return false;
        if (ch == '\r' || ch == '\n') { std::cout << "\r\n"; return true; }
        if (ch == 8 || ch == 127) {
            if (!out.empty()) out.pop_back();
        } else if (ch == 0 || ch == 0xE0) {
            _getch();
        } else if (ch >= 32) {
            out += static_cast<char>(ch);
        }
    }
}

// ── 清屏（Linux tty 登录循环每次重新提示前清屏）──────
static void clear_screen() {
    system("cls");
}

// ── 首次初始化：为 root 设置初始密码 ─────────────────
static bool first_run_setup(amsys::PasswdShadow& ps) {
    std::cout << "首次启动检测到未初始化用户数据库。\r\n";
    std::cout << "请为 root 用户设置初始密码。\r\n";

    std::string p1, p2;
    while (true) {
        std::cout << "New password: " << std::flush;
        if (!read_password(p1)) return false;
        if (p1.empty()) { std::cout << "密码不能为空。\r\n"; continue; }

        std::cout << "Retype new password: " << std::flush;
        if (!read_password(p2)) return false;
        if (p1 != p2) { std::cout << "两次输入不一致，请重试。\r\n"; continue; }
        break;
    }

    std::string hash = amsys::md5_hex(p1);
    if (!ps.create_initial_root(hash)) {
        std::cout << "初始化失败（/etc/shadow 已存在或无法写入）。\r\n";
        return false;
    }
    std::cout << "root 密码已设置。请登录。\r\n\r\n";
    return true;
}

// ── 启动 amsys ───────────────────────────────────────
static int launch_amsys(const std::string& username) {
    // amsys.exe 优先取 launcher 同目录
    char exe_path[MAX_PATH];
    GetModuleFileNameA(nullptr, exe_path, MAX_PATH);
    std::string dir(exe_path);
    auto pos = dir.find_last_of("\\/");
    if (pos != std::string::npos) dir = dir.substr(0, pos);

    std::string amsys_exe = dir + "\\amsys.exe";
    if (GetFileAttributesA(amsys_exe.c_str()) == INVALID_FILE_ATTRIBUTES) {
        amsys_exe = "amsys.exe"; // 回退：PATH 搜索
    }

    std::string cmdline = "\"" + amsys_exe + "\" --user " + username;

    STARTUPINFOA si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    if (!CreateProcessA(amsys_exe.c_str(), cmdline.data(), nullptr, nullptr,
                        TRUE, 0, nullptr, nullptr, &si, &pi)) {
        std::cout << "无法启动 amsys: " << amsys_exe << "\r\n";
        return 1;
    }

    CloseHandle(pi.hThread);
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    return static_cast<int>(code);
}

// ── main ─────────────────────────────────────────────
int main() {
    init_console();

    amsys::Config config;
    std::string config_path = "config.ini";
    // 与 amsys main 相同的查找顺序：exe 同目录 → 上级 → 当前目录
    {
        char exe_path[MAX_PATH];
        GetModuleFileNameA(nullptr, exe_path, MAX_PATH);
        std::string dir(exe_path);
        auto p = dir.find_last_of("\\/");
        if (p != std::string::npos) dir = dir.substr(0, p);

        std::string cand = dir + "\\config.ini";
        std::ifstream t(cand);
        if (t.is_open()) {
            config_path = cand;
        } else {
            cand = dir + "\\..\\config.ini";
            t.open(cand);
            if (t.is_open()) config_path = cand;
        }
    }
    if (!config.load(config_path)) {
        std::cout << "无法读取配置文件: " << config_path << "\r\n";
        return 1;
    }

    amsys::PathManager pm(config);
    amsys::PasswdShadow ps(pm);

    // ── 首次初始化 ──────────────────────────────────
    if (!ps.shadow_exists()) {
        if (!first_run_setup(ps)) return 1;
    }

    // ── 登录循环（Linux tty 风格，失败无限重试，每次提示前清屏）─────
    std::string username;
    while (true) {
        clear_screen(); // 每次重新提示登录前清屏
        if (g_ctrl_c) { std::cout << "登录已取消。\r\n"; return 130; }

        std::cout << "amsys login\nUser name: " << std::flush;
        if (!read_line(username)) { std::cout << "登录已取消。\r\n"; return 130; }
        if (username.empty()) continue;

        // passwd 中无此用户 → 直接失败
        if (!ps.user_exists(username)) {
            std::cout << "User undefind!\r\n";
            Sleep(1200); // 让错误信息短暂可见（Linux login 停顿）
            continue;    // 回到循环顶部清屏重新提示
        }

        std::cout << "Password: " << std::flush;
        std::string password;
        if (!read_password(password)) { std::cout << "登录已取消。\r\n"; return 130; }

        // 根据 shadow 条目状态处理：
        //   NoEntry  → 从未配置密码 → 拒绝登录
        //   Locked   → 账户锁定（!/*）→ 拒绝登录
        //   EmptyHash→ 配置的是空密码 → 仅允许空密码登录
        //   HasHash  → 有密码哈希 → 正常比对
        switch (ps.shadow_state(username)) {
            case amsys::ShadowState::NoEntry:
                std::cout << "Password not set\r\n";
                Sleep(1200); // 让错误信息短暂可见（Linux login 停顿）
                continue;    // 回到循环顶部清屏重新提示
            case amsys::ShadowState::Locked:
                std::cout << "Password incorrect\r\n";
                Sleep(1200);
                continue;
            case amsys::ShadowState::EmptyHash:
                if (!password.empty()) {
                    std::cout << "Password incorrect\r\n";
                    Sleep(1200);
                    continue;
                }
                break; // 空密码匹配 → 登录成功
            case amsys::ShadowState::HasHash: {
                std::string stored_hash;
                if (!ps.get_shadow_hash(username, stored_hash) ||
                    !amsys::verify_password(password, stored_hash)) {
                    std::cout << "Password incorrect\r\n";
                    Sleep(1200);
                    continue;
                }
                break;
            }
        }

        break; // 登录成功
    }

    // ── 成功：欢迎 + 启动 amsys ─────────────────────
    return launch_amsys(username);
}
