import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @State private var repoPath: String?
    @State private var items: [LibraryItem] = []
    @State private var selection: LibraryItem.ID?
    @State private var isDropTargeted = false
    @State private var isLoadingLibrary = false
    @State private var hasLoadedLibrary = false
    @State private var isPublishingAll = false
    @State private var publishAllProgress = 0

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider()
            NavigationSplitView {
                sidebar
            } detail: {
                detailContent
            }
        }
        .frame(minWidth: 920, minHeight: 640)
        .onAppear {
            repoPath = RepoLocator.resolvedRepoPath()
            if !hasLoadedLibrary {
                hasLoadedLibrary = true
                loadLibrary()
            }
        }
    }

    // MARK: - Derived collections

    private var newItems: [LibraryItem] { items.filter { !$0.isExisting } }
    private var existingItems: [LibraryItem] { items.filter { $0.isExisting } }
    private var orderedForNav: [LibraryItem] { newItems + existingItems }

    // MARK: - Header

    private var headerBar: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Photo Library").font(.headline)
                repoRow
            }

            Spacer()

            if isLoadingLibrary {
                ProgressView().controlSize(.small)
                Text("Loading library…").font(.caption).foregroundStyle(.secondary)
            }

            Button {
                chooseImages()
            } label: {
                Label("Add Photos", systemImage: "plus")
            }
            .onDrop(of: [.fileURL], isTargeted: $isDropTargeted, perform: handleDrop)

            if isPublishingAll {
                ProgressView(value: Double(publishAllProgress), total: Double(max(newItems.count, 1)))
                    .frame(width: 120)
                Text("\(publishAllProgress)/\(newItems.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if !newItems.isEmpty {
                Button("Publish All New (\(newItems.count))") { publishAllNew() }
                    .keyboardShortcut(.return, modifiers: .command)
                    .buttonStyle(.borderedProminent)
                    .disabled(repoPath == nil)
            }
        }
        .padding(12)
        .background(isDropTargeted ? Color.accentColor.opacity(0.08) : Color.clear)
    }

    private var repoRow: some View {
        HStack(spacing: 6) {
            Text(repoPath ?? "No website folder selected")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Button("Change…") { chooseRepo() }
                .font(.caption)
                .buttonStyle(.link)
        }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        List(selection: $selection) {
            if !newItems.isEmpty {
                Section("New (\(newItems.count))") {
                    ForEach(newItems) { item in
                        SidebarRow(item: item).tag(item.id)
                    }
                    .onDelete(perform: removeNewItems)
                }
            }
            Section("Published (\(existingItems.count))") {
                if existingItems.isEmpty && !isLoadingLibrary {
                    Text("No photos on the site yet")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(existingItems) { item in
                    SidebarRow(item: item).tag(item.id)
                }
            }
        }
        .listStyle(.sidebar)
    }

    @ViewBuilder
    private var detailContent: some View {
        if let id = selection,
           let realIdx = items.firstIndex(where: { $0.id == id }),
           let navIdx = orderedForNav.firstIndex(where: { $0.id == id }) {
            MetadataFormView(
                item: $items[realIdx],
                index: navIdx,
                total: orderedForNav.count,
                isFirst: navIdx == 0,
                isLast: navIdx == orderedForNav.count - 1,
                onLoadExif: { loadExif(for: id) },
                onPrev: goPrev,
                onNext: goNext,
                onSave: { saveItem(id) },
                onPublish: { publishSingle(id) },
                onDelete: { deleteItem(id) }
            )
            .id(id)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "photo")
                    .font(.system(size: 28))
                    .foregroundStyle(.secondary)
                Text(items.isEmpty ? "Your library is empty — click Add Photos to publish your first one." : "Select a photo")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 320)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Navigation

    private func goNext() {
        guard let id = selection, let idx = orderedForNav.firstIndex(where: { $0.id == id }), idx < orderedForNav.count - 1 else { return }
        selection = orderedForNav[idx + 1].id
    }

    private func goPrev() {
        guard let id = selection, let idx = orderedForNav.firstIndex(where: { $0.id == id }), idx > 0 else { return }
        selection = orderedForNav[idx - 1].id
    }

    // MARK: - Repo / image selection

    private func chooseRepo() {
        if let path = RepoLocator.promptForRepo() {
            repoPath = path
            hasLoadedLibrary = false
            items.removeAll { $0.isExisting }
            hasLoadedLibrary = true
            loadLibrary()
        }
    }

    private func chooseImages() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image, .heic]
        if panel.runModal() == .OK {
            addDrafts(from: panel.urls)
        }
    }

    private func handleDrop(providers: [NSItemProvider]) -> Bool {
        guard !providers.isEmpty else { return false }
        for provider in providers {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                DispatchQueue.main.async {
                    addDrafts(from: [url])
                }
            }
        }
        return true
    }

    private func addDrafts(from urls: [URL]) {
        let newDrafts = urls.map { LibraryItem(sourceURL: $0) }
        items.append(contentsOf: newDrafts)
        if selection == nil {
            selection = newDrafts.first?.id
        }
    }

    private func removeNewItems(at offsets: IndexSet) {
        let idsToRemove = Set(offsets.map { newItems[$0].id })
        items.removeAll { idsToRemove.contains($0.id) }
        if let id = selection, idsToRemove.contains(id) {
            selection = orderedForNav.first?.id
        }
    }

    // MARK: - Loading the existing library

    private func loadLibrary() {
        guard let repoPath else { return }
        isLoadingLibrary = true
        DispatchQueue.global(qos: .userInitiated).async {
            let posts = PhotoEngine.listPhotos(repoPath: repoPath)
            let mapped = posts.map { LibraryItem(existing: $0, repoPath: repoPath) }
            DispatchQueue.main.async {
                items.append(contentsOf: mapped)
                if selection == nil {
                    selection = orderedForNav.first?.id
                }
                isLoadingLibrary = false
            }
        }
    }

    // MARK: - EXIF prefill (new items only)

    private func loadExif(for id: LibraryItem.ID) {
        guard let idx = items.firstIndex(where: { $0.id == id }), !items[idx].exifLoaded, let sourceURL = items[idx].sourceURL else { return }
        items[idx].exifLoaded = true

        DispatchQueue.global(qos: .userInitiated).async {
            let info = PhotoEngine.fetchExif(sourceURL: sourceURL)
            DispatchQueue.main.async {
                guard let idx2 = items.firstIndex(where: { $0.id == id }) else { return }
                items[idx2].make = info.make ?? ""
                items[idx2].model = info.model ?? ""
                items[idx2].lens = info.lens ?? ""
                items[idx2].aperture = info.aperture ?? ""
                items[idx2].shutter = info.shutter ?? ""
                items[idx2].iso = info.iso ?? ""
                items[idx2].focalLength = info.focalLength ?? ""
                items[idx2].dateTaken = info.dateTaken ?? ""
                items[idx2].location = info.location ?? ""
                items[idx2].width = info.width
                items[idx2].height = info.height
                if let dt = info.dateTaken, let parsed = LibraryItem.parseDate(dt) {
                    items[idx2].date = parsed
                }
            }
        }
    }

    // MARK: - Publishing new items

    private func publishSingle(_ id: LibraryItem.ID) {
        guard let repoPath, let idx = items.firstIndex(where: { $0.id == id }) else { return }
        items[idx].status = .working
        let snapshot = items[idx]

        DispatchQueue.global(qos: .userInitiated).async {
            applyPublishOutcome(id: id, snapshot: snapshot, repoPath: repoPath)
        }
    }

    private func publishAllNew() {
        guard let repoPath else { return }
        let ids = newItems.map(\.id)
        guard !ids.isEmpty else { return }
        isPublishingAll = true
        publishAllProgress = 0

        DispatchQueue.global(qos: .userInitiated).async {
            for id in ids {
                var snapshot: LibraryItem?
                DispatchQueue.main.sync {
                    if let idx = items.firstIndex(where: { $0.id == id }) {
                        items[idx].status = .working
                        snapshot = items[idx]
                    }
                }
                guard let item = snapshot else { continue }
                applyPublishOutcome(id: id, snapshot: item, repoPath: repoPath, sync: true)
                DispatchQueue.main.sync { publishAllProgress += 1 }
            }
            DispatchQueue.main.async {
                isPublishingAll = false
            }
        }
    }

    /// Runs PhotoEngine.addPhoto (off the main thread) and applies the
    /// result. `sync` picks main.sync vs main.async for the UI update, since
    /// the publish-all loop needs each step to land before moving on.
    private func applyPublishOutcome(id: LibraryItem.ID, snapshot: LibraryItem, repoPath: String, sync: Bool = false) {
        guard let sourceURL = snapshot.sourceURL else { return }
        let apply: () -> Void
        do {
            let slug = try PhotoEngine.addPhoto(sourceURL: sourceURL, input: snapshot.metadataInput(), repoPath: repoPath)
            apply = {
                guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
                items[idx].kind = .existing(slug: slug)
                let siteRoot = URL(fileURLWithPath: repoPath).appendingPathComponent("photography")
                items[idx].thumbFileURL = siteRoot.appendingPathComponent("images/thumb/\(slug).jpg")
                items[idx].fullFileURL = siteRoot.appendingPathComponent("images/full/\(slug).jpg")
                items[idx].status = .done(message: "Published")
            }
        } catch {
            let message = error.localizedDescription
            apply = {
                guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
                items[idx].status = .failed(message)
            }
        }
        if sync {
            DispatchQueue.main.sync(execute: apply)
        } else {
            DispatchQueue.main.async(execute: apply)
        }
    }

    // MARK: - Editing / deleting existing items

    private func saveItem(_ id: LibraryItem.ID) {
        guard let repoPath, let idx = items.firstIndex(where: { $0.id == id }), case .existing(let slug) = items[idx].kind else { return }
        items[idx].status = .working
        let snapshot = items[idx]

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try PhotoEngine.updatePhoto(slug: slug, input: snapshot.metadataInput(), repoPath: repoPath)
                DispatchQueue.main.async {
                    guard let idx2 = items.firstIndex(where: { $0.id == id }) else { return }
                    items[idx2].status = .done(message: "Saved")
                }
            } catch {
                let message = error.localizedDescription
                DispatchQueue.main.async {
                    guard let idx2 = items.firstIndex(where: { $0.id == id }) else { return }
                    items[idx2].status = .failed(message)
                }
            }
        }
    }

    private func deleteItem(_ id: LibraryItem.ID) {
        guard let repoPath, let idx = items.firstIndex(where: { $0.id == id }), case .existing(let slug) = items[idx].kind else { return }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try PhotoEngine.removePhoto(slug: slug, repoPath: repoPath)
                DispatchQueue.main.async {
                    items.removeAll { $0.id == id }
                    if selection == id {
                        selection = orderedForNav.first?.id
                    }
                }
            } catch {
                let message = error.localizedDescription
                DispatchQueue.main.async {
                    guard let idx2 = items.firstIndex(where: { $0.id == id }) else { return }
                    items[idx2].status = .failed(message)
                }
            }
        }
    }
}
