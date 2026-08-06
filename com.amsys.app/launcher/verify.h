#ifndef LAUNCHER_VERIFY_H
#define LAUNCHER_VERIFY_H

// 密码哈希校验（独立模块，便于单元测试）。
// stored_hash 格式：
//   {SHA1}<hex40>  → SHA-1
//   {MD5}<hex32>   → MD5
//   裸 hex         → 默认按 MD5（32 hex）
// hex 比较不区分大小写。

#include <string>
#include <cstring>

#include "md5.h"
#include "sha1.h"

namespace amsys {

inline bool verify_password(const std::string& password, const std::string& stored_hash) {
    std::string expected = stored_hash;
    bool use_sha1 = false;
    if (expected.rfind("{SHA1}", 0) == 0) {
        expected = expected.substr(6);
        use_sha1 = true;
    } else if (expected.rfind("{MD5}", 0) == 0) {
        expected = expected.substr(5);
    }

    std::string computed = use_sha1 ? sha1_hex(password) : md5_hex(password);
    return computed.size() == expected.size() &&
           _stricmp(computed.c_str(), expected.c_str()) == 0;
}

} // namespace amsys

#endif // LAUNCHER_VERIFY_H
