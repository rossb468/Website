import SwiftUI

@main
struct PhotoUploaderApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 920, idealWidth: 1040, minHeight: 640, idealHeight: 760)
        }
        .windowResizability(.contentMinSize)
    }
}
