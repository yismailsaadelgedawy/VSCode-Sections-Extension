// %% Models
data class User(
  val name: String,
  val age: Int
)

// %% Services
class UserService {
  fun displayName(user: User): String {
    return user.name
  }
}

// %% Entry Point
fun main() {
  val user = User("Ada", 32)
  println(UserService().displayName(user))
}
