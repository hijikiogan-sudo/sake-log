import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the web app from the app bundle as app://localhost/...
///
/// A custom scheme gives the page a stable origin, so localStorage persists
/// between launches and the camera (getUserMedia) is available. Nothing is
/// loaded from the network.
@MainActor
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let startURL = URL(string: "app://localhost/index.html")!

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        // Query strings such as ?v=... are cache busters for the web version.
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL

        // Refuse anything outside the bundled folder (e.g. "../").
        guard file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(response)
            task.didFinish()
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
