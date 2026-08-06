#include "passwd_shadow.h"

#include <fstream>
#include <sstream>
#include <filesystem>

namespace amsys {

namespace {

// 去掉行尾 \r（兼容 CRLF 文件）
std::string trim_cr(const std::string& s) {
    if (!s.empty() && s.back() == '\r') return s.substr(0, s.size() - 1);
    return s;
}

// 用 PathManager 把 Unix 路径翻译为 Windows 路径
std::string win_path(PathManager& pm, const std::string& unix_path) {
    std::string resolved = pm.resolve(unix_path);
    if (resolved.empty()) return "";
    if (pm.is_virtual_dir(resolved)) return "";
    return pm.to_windows(resolved);
}

bool read_lines(const std::string& path, std::vector<std::string>& out) {
    std::ifstream f(path);
    if (!f.is_open()) return false;
    std::string line;
    while (std::getline(f, line)) out.push_back(trim_cr(line));
    return true;
}

} // namespace

// ── 定位 ─────────────────────────────────────────────

std::string PasswdShadow::passwd_win_path() const {
    return win_path(pm_, "/etc/passwd");
}

std::string PasswdShadow::shadow_win_path() const {
    return win_path(pm_, "/etc/shadow");
}

bool PasswdShadow::passwd_exists() const {
    std::string p = passwd_win_path();
    if (p.empty()) return false;
    std::error_code ec;
    return std::filesystem::is_regular_file(p, ec);
}

bool PasswdShadow::shadow_exists() const {
    std::string p = shadow_win_path();
    if (p.empty()) return false;
    std::error_code ec;
    return std::filesystem::is_regular_file(p, ec);
}

// ── 解析 ─────────────────────────────────────────────

bool PasswdShadow::ensure_loaded() const {
    if (loaded_) return true;

    std::vector<std::string> lines;
    if (read_lines(passwd_win_path(), lines)) {
        for (const auto& raw : lines) {
            if (raw.empty() || raw[0] == '#') continue;
            // passwd 格式: name:x:uid:gid:gecos:home:shell
            auto colon = raw.find(':');
            if (colon == std::string::npos || colon == 0) continue;
            passwd_users_.emplace_back(raw.substr(0, colon), "");
        }
    }

    lines.clear();
    if (read_lines(shadow_win_path(), lines)) {
        for (const auto& raw : lines) {
            if (raw.empty() || raw[0] == '#') continue;
            // shadow 格式: name:hash:lastchg:min:max:warn:inactive:expire
            auto colon = raw.find(':');
            if (colon == std::string::npos || colon == 0) continue;
            std::string rest = raw.substr(colon + 1);
            auto colon2 = rest.find(':');
            std::string hash = (colon2 == std::string::npos) ? rest : rest.substr(0, colon2);
            shadow_users_.emplace_back(raw.substr(0, colon), hash);
        }
    }

    loaded_ = true;
    return true;
}

bool PasswdShadow::user_exists(const std::string& name) const {
    ensure_loaded();
    for (const auto& [n, _] : passwd_users_) {
        if (n == name) return true;
    }
    return false;
}

ShadowState PasswdShadow::shadow_state(const std::string& name) const {
    ensure_loaded();
    for (const auto& [n, hash] : shadow_users_) {
        if (n != name) continue;
        if (hash == "!" || hash == "*") return ShadowState::Locked;
        if (hash.empty()) return ShadowState::EmptyHash;
        return ShadowState::HasHash;
    }
    return ShadowState::NoEntry;
}

bool PasswdShadow::get_shadow_hash(const std::string& name, std::string& hash_out) const {
    ensure_loaded();
    for (const auto& [n, hash] : shadow_users_) {
        if (n != name) continue;
        if (hash.empty() || hash == "!" || hash == "*") return false;
        hash_out = hash;
        return true;
    }
    return false;
}

// ── 首次初始化 ───────────────────────────────────────

bool PasswdShadow::create_initial_root(const std::string& root_hash_hex) const {
    std::string passwd_path = passwd_win_path();
    std::string shadow_path = shadow_win_path();
    if (passwd_path.empty() || shadow_path.empty()) return false;

    // 仅当 shadow 不存在时初始化（passwd 可能已由 amsys 的 ensure_passwd 创建，
    // 因此不能以 passwd 缺失作为触发条件，也不能覆盖已有 passwd）
    if (shadow_exists()) return false;

    std::error_code ec;
    std::filesystem::path dir = std::filesystem::path(passwd_path).parent_path();
    std::filesystem::create_directories(dir, ec);
    if (ec) return false;

    // passwd：缺失则创建标准条目；存在但没有 root 则追加 root 条目
    if (!passwd_exists()) {
        std::ofstream pw(passwd_path, std::ios::binary);
        if (!pw.is_open()) return false;
        pw << "root:x:0:0:root:/root:/bin/amsys\n";
        pw.close();
        if (!pw) return false;
    } else {
        bool has_root = false;
        {
            std::ifstream pf(passwd_path);
            std::string line;
            while (std::getline(pf, line)) {
                if (line == "root:x:0:0:root:/root:/bin/amsys") { has_root = true; break; }
            }
        }
        if (!has_root) {
            std::ofstream pw(passwd_path, std::ios::binary | std::ios::app);
            if (!pw.is_open()) return false;
            pw << "root:x:0:0:root:/root:/bin/amsys\n";
            pw.close();
            if (!pw) return false;
        }
    }

    // shadow 条目（裸 hex 哈希；生命周期字段取常见默认值）
    std::ofstream sh(shadow_path, std::ios::binary);
    if (!sh.is_open()) return false;
    sh << "root:" << root_hash_hex << ":0:99999:7:::\n";
    sh.close();
    if (!sh) return false;

    loaded_ = false; // 缓存失效，下次重新加载
    return true;
}

} // namespace amsys
