import AppKit
import Foundation

enum RepoLocator {
    private static let defaultsKey = "websiteRepoPath"

    static var savedRepoPath: String? {
        get { UserDefaults.standard.string(forKey: defaultsKey) }
        set { UserDefaults.standard.set(newValue, forKey: defaultsKey) }
    }

    static func isValidRepo(_ path: String) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    /// Opens a folder picker so the user can point the app at their website
    /// folder. photography/ is created inside it on demand if it doesn't
    /// exist yet. Remembered for next time.
    static func promptForRepo() -> String? {
        let panel = NSOpenPanel()
        panel.title = "Select Your Website Folder"
        panel.message = "Choose your website's root folder — photography/ lives inside it"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"

        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        let path = url.path
        savedRepoPath = path
        return path
    }

    static func resolvedRepoPath() -> String? {
        if let saved = savedRepoPath, isValidRepo(saved) {
            return saved
        }
        return promptForRepo()
    }
}
