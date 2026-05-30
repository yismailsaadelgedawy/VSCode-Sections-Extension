// %% Models
struct User {
  let name: String
  let age: Int
}

// %% Services
final class UserService {
  func displayName(for user: User) -> String {
    return user.name
  }
}

// %% Entry Point
let user = User(name: "Ada", age: 32)
print(UserService().displayName(for: user))
