# Swift Concurrency in Practice

Swift's `async/await` syntax makes writing concurrent code much simpler. Let's look at a quick example:

```
func fetchData() async throws -> Data {
    let url = URL(string: "https://example.com/api")!
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}
```

## Key Concepts

1. Mark functions with `async` if they perform asynchronous work
2. Use `await` when calling async functions
3. Use `Task` to bridge sync and async code

For more details, check the [Swift documentation](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/).
