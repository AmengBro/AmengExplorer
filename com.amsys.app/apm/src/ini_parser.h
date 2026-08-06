#ifndef AMSYS_INI_PARSER_H
#define AMSYS_INI_PARSER_H

#include <string>
#include <unordered_map>

namespace apm {

// Minimal INI parser — reads [section] and key=value lines.
// Comments: leading ; or #.  No multi-line values, no escapes.
class IniParser {
public:
    bool load(const std::string& path);

    // Get a value from section.key, e.g. get("package", "name")
    // Returns empty string if not found.
    std::string get(const std::string& section, const std::string& key) const;

    // For debugging / validation
    bool has_section(const std::string& section) const;
    bool has_key(const std::string& section, const std::string& key) const;

private:
    // stored as section -> (key -> value)
    std::unordered_map<std::string, std::unordered_map<std::string, std::string>> data_;
};

} // namespace apm

#endif // AMSYS_INI_PARSER_H
