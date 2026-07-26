import AppKit
import SwiftUI

struct MetadataFormView: View {
    @Binding var item: LibraryItem
    let index: Int
    let total: Int
    let isFirst: Bool
    let isLast: Bool
    let onLoadExif: () -> Void
    let onPrev: () -> Void
    let onNext: () -> Void
    let onSave: () -> Void
    let onPublish: () -> Void
    let onDelete: () -> Void

    @State private var showingDeleteConfirm = false

    var body: some View {
        VStack(spacing: 0) {
            preview

            Form {
                Section {
                    TextField("Title", text: $item.title)
                        .textFieldStyle(.roundedBorder)
                    TextField("Caption", text: $item.caption, axis: .vertical)
                        .lineLimit(2...5)
                        .multilineTextAlignment(.leading)
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Label("Description", systemImage: "text.alignleft")
                }

                Section {
                    DatePicker("Post Date", selection: $item.date, displayedComponents: .date)
                    TextField("Date Taken", text: $item.dateTaken, prompt: Text("2026-07-20 14:30:00"))
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Label("Date", systemImage: "calendar")
                }

                Section {
                    TextField("Make", text: $item.make, prompt: Text("Camera make"))
                        .textFieldStyle(.roundedBorder)
                    TextField("Model", text: $item.model, prompt: Text("Camera model"))
                        .textFieldStyle(.roundedBorder)
                    TextField("Lens", text: $item.lens, prompt: Text("Lens"))
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Label("Camera", systemImage: "camera")
                }

                Section {
                    TextField("Aperture", text: $item.aperture, prompt: Text("f/2.8"))
                        .textFieldStyle(.roundedBorder)
                    TextField("Shutter Speed", text: $item.shutter, prompt: Text("1/500s"))
                        .textFieldStyle(.roundedBorder)
                    TextField("ISO", text: $item.iso, prompt: Text("ISO 200"))
                        .textFieldStyle(.roundedBorder)
                    TextField("Focal Length", text: $item.focalLength, prompt: Text("35mm"))
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Label("Exposure", systemImage: "dial.medium")
                }

                Section {
                    TextField("Coordinates", text: $item.location, prompt: Text("40.71, -74.01"))
                        .textFieldStyle(.roundedBorder)
                } header: {
                    Label("Location", systemImage: "location")
                } footer: {
                    if !item.location.isEmpty {
                        Text("This is published on the photo's page. Clear it if you'd rather not share where it was taken.")
                    }
                }

                if let w = item.width, let h = item.height {
                    Section {
                        LabeledContent("Dimensions", value: "\(w) × \(h)")
                        LabeledContent("File", value: item.sourceURL?.lastPathComponent ?? item.displayTitle)
                    } header: {
                        Label("File Info", systemImage: "info.circle")
                    }
                }
            }
            .formStyle(.grouped)

            Divider()
            stepControls
        }
        .onAppear {
            if !item.exifLoaded {
                onLoadExif()
            }
        }
        .confirmationDialog(
            "Delete this photo from the site?",
            isPresented: $showingDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes its page and images from photography/. This can't be undone from within the app.")
        }
    }

    private var preview: some View {
        Group {
            if let url = item.previewURL, let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxHeight: 240)
            }
        }
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.06))
    }

    private var stepControls: some View {
        HStack {
            Button {
                onPrev()
            } label: {
                Label("Previous", systemImage: "chevron.left")
            }
            .disabled(isFirst)

            Spacer()

            if item.isExisting {
                Button(role: .destructive) {
                    showingDeleteConfirm = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }

                Button {
                    onSave()
                } label: {
                    Label("Save Changes", systemImage: "checkmark")
                }
                .buttonStyle(.borderedProminent)
            } else {
                Button {
                    onPublish()
                } label: {
                    Label("Publish This Photo", systemImage: "arrow.up.doc")
                }
                .buttonStyle(.borderedProminent)
            }

            Spacer()

            Button {
                onNext()
            } label: {
                Label("Next", systemImage: "chevron.right")
            }
            .disabled(isLast)
        }
        .padding(12)
    }
}
