# Third-party software

The Windows app bundles Electron 43.4.0 (MIT), including Chromium and Node.js.
Electron's distributions include their third-party license notices, including
LICENSES.chromium.html. These files are retained by the Windows packager.

electron-builder 26.15.3 is a development/build dependency (MIT). It is not an
application feature or a separately required install for end users.

Windows PowerShell is provided by Windows and is not bundled. The collector
uses Windows CIM, PnP and registry APIs in read-only mode.

The T logo and demo screenshot are generated specifically for this project.
No DJI software, module firmware or private user data is included.

Lucide 1.43.0 is bundled as a local browser icon library. Its ISC license and
Feather-derived icon notices are included in public/vendor/LUCIDE-LICENSE.
No external icon CDN or network request is required by the UI.
