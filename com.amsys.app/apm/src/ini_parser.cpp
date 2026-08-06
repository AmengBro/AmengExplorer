#include "ini_parser.h"
#include <fstream>
#include <sstream>
#include <algorithm>

namespace apm {

bool IniParser::load(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) return false;

    data_.clear();
    std::string current_section;
    std::string line;

    while (std::getline(file, line)) {
        // Strip trailing \r (Windows line endings)
        if (!line.empty() && line.back() == '\r')
            line.pop_back();

        // Trim leading/trailing whitespace
        size_t start = line.find_first_not_of(" \t");
        if (start == std::string::npos) continue; // blank line
        size_t end = line.find_last_not_of(" \t");
        std::string trimmed = line.substr(start, end - start + 1);

        // Comment
        if (trimmed[0] == ';' || trimmed[0] == '#') continue;

        // Section: [section]
        if (trimmed[0] == '[') {
            size_t close = trimmed.find(']');
            if (close != std::string::npos) {
                current_section = trimmed.substr(1, close - 1);
                // Trim section name
                size_t ss = current_section.find_first_not_of(" \t");
                size_t se = current_section.find_last_not_of(" \t");
                if (ss != std::string::npos)
                    current_section = current_section.substr(ss, se - ss + 1);
            }
            continue;
        }

        // Key=value
        size_t eq = trimmed.find('=');
        if (eq == std::string::npos) continue;

        std::string key = trimmed.substr(0, eq);
        std::string val = trimmed.substr(eq + 1);

        // Trim key
        size_t ks = key.find_first_not_of(" \t");
        size_t ke = key.find_last_not_of(" \t");
        if (ks != std::string::npos) key = key.substr(ks, ke - ks + 1);

        // Trim value
        size_t vs = val.find_first_not_of(" \t");
        size_t ve = val.find_last_not_of(" \t");
        if (vs != std::string::npos)
            val = val.substr(vs, ve - vs + 1);
        else
            val.clear();

        // Remove inline comments from value (only if preceded by space)
        // Simple: if ; or # appears in value after a space, strip from there
        size_t comment_pos = std::string::npos;
        for (size_t i = 1; i < val.size(); i++) {
            if ((val[i] == ';' || val[i] == '#') && val[i-1] == ' ') {
                comment_pos = i;
                break;
            }
        }
        if (comment_pos != std::string::npos) {
            val = val.substr(0, comment_pos);
            // Re-trim
            ve = val.find_last_not_of(" \t");
            if (ve != std::string::npos)
                val = val.substr(0, ve + 1);
            else
                val.clear();
        }

        if (!key.empty() && !current_section.empty()) {
            data_[current_section][key] = val;
        }
    }

    return true;
}

std::string IniParser::get(const std::string& section, const std::string& key) const {
    auto sit = data_.find(section);
    if (sit == data_.end()) return {};
    auto kit = sit->second.find(key);
    if (kit == sit->second.end()) return {};
    return kit->second;
}

bool IniParser::has_section(const std::string& section) const {
    return data_.find(section) != data_.end();
}

bool IniParser::has_key(const std::string& section, const std::string& key) const {
    auto sit = data_.find(section);
    if (sit == data_.end()) return false;
    return sit->second.find(key) != sit->second.end();
}

} // namespace apm
