import AppKit
import SwiftUI

struct SidebarRow: View {
    let item: LibraryItem

    var body: some View {
        HStack(spacing: 10) {
            thumbnail
            VStack(alignment: .leading, spacing: 2) {
                Text(item.displayTitle)
                    .lineLimit(1)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(statusColor)
            }
            Spacer(minLength: 4)
            statusIcon
        }
        .padding(.vertical, 3)
    }

    private var thumbnail: some View {
        Group {
            if let url = item.thumbnailURL, let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color.secondary.opacity(0.15)
            }
        }
        .frame(width: 36, height: 36)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private var statusText: String {
        switch item.status {
        case .idle: return item.isExisting ? "Published" : "Not published"
        case .working: return item.isExisting ? "Saving…" : "Publishing…"
        case .done(let message): return message
        case .failed: return "Failed"
        }
    }

    private var statusColor: Color {
        switch item.status {
        case .idle: return item.isExisting ? .secondary : .secondary
        case .working: return .blue
        case .done: return .green
        case .failed: return .red
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch item.status {
        case .idle:
            if item.isExisting {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green.opacity(0.6))
            } else {
                EmptyView()
            }
        case .working:
            ProgressView().controlSize(.small)
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
    }
}
