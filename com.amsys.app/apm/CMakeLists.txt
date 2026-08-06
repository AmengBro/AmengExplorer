cmake_minimum_required(VERSION 3.16)
project(apm LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -Wextra")

file(GLOB SOURCES src/*.cpp)
add_executable(apm ${SOURCES})

# Output to amsys root/bin so it's in the virtual filesystem
set_target_properties(apm PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../root/bin"
)
