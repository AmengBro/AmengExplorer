#ifndef LAUNCHER_PASSWD_SHADOW_H
#define LAUNCHER_PASSWD_SHADOW_H

// 登录验证用的 /etc/passwd 与 /etc/shadow 访问层。
// 路径定位完全复用 amsys 的 PathManager（config.ini 的 [system] root + 虚拟根解析），
// 因此与 amsys 内部的路径语义保持一致。

#include <string>
#include <vector>
#include <utility>

#include "path_manager.h"

namespace amsys {

// shadow 中某用户的密码条目状态
enum class ShadowState {
    NoEntry,   // shadow 中没有该用户条目（从未配置密码）→ 拒绝登录
    Locked,    // 有条目但密码字段为 ! 或 *（账户锁定）→ 拒绝登录
    EmptyHash, // 有条目且密码字段为空（配置的是空密码）→ 允许空密码登录
    HasHash,   // 有条目且有密码哈希 → 正常比对
};

class PasswdShadow {
public:
    explicit PasswdShadow(PathManager& pm) : pm_(pm) {}

    // ── 定位 ─────────────────────────────────────────
    // 通过 PathManager 将 /etc/passwd、/etc/shadow 翻译为 Windows 路径
    std::string passwd_win_path() const;
    std::string shadow_win_path() const;
    bool passwd_exists() const;
    bool shadow_exists() const;

    // ── 查询 ─────────────────────────────────────────
    // passwd 中是否存在该用户名
    bool user_exists(const std::string& name) const;
    // shadow 中该用户的密码条目状态（区分未配置 / 锁定 / 空密码 / 有哈希）
    ShadowState shadow_state(const std::string& name) const;
    // 取 shadow 中该用户的哈希（仅当 shadow_state 为 HasHash 时有效）
    bool get_shadow_hash(const std::string& name, std::string& hash_out) const;

    // ── 首次初始化 ───────────────────────────────────
    // 确保 root 用户可登录：shadow 不存在时初始化。
    // passwd 缺失则创建标准条目，存在但没有 root 则追加 root 条目；
    // 然后创建 /etc/shadow（root 密码为给定裸 hex 哈希）。
    // shadow 已存在时不覆盖，返回 false。
    bool create_initial_root(const std::string& root_hash_hex) const;

private:
    // 懒加载解析缓存
    bool ensure_loaded() const;

    PathManager& pm_;
    mutable bool loaded_ = false;
    mutable std::vector<std::pair<std::string, std::string>> passwd_users_;  // name -> (忽略)
    mutable std::vector<std::pair<std::string, std::string>> shadow_users_;  // name -> hash
};

} // namespace amsys

#endif // LAUNCHER_PASSWD_SHADOW_H
