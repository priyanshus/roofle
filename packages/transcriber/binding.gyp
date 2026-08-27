{
  "targets": [
    {
      "target_name": "screencapturekit_addon",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "native/addon.mm",
        "native/wrapper.mm"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "native"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "13.0",
              "OTHER_CFLAGS": ["-fno-objc-arc"],
              "WARNING_CFLAGS": [
                "-Wall",
                "-Wextra",
                "-Wno-unused-parameter"
              ],
              "USE_HEADERMAP": "NO"
            },
            "link_settings": {
              "libraries": [
                "-framework ScreenCaptureKit",
                "-framework Foundation",
                "-framework AVFoundation",
                "-framework CoreMedia",
                "-framework CoreVideo"
              ]
            }
          }
        ]
      ]
    }
  ]
}
