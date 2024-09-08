# Online Chess School Backend

This is the backend for an online chess school, built with Node.js, Express, and MongoDB. The project includes user management, registration, authentication, and the ability to manage the relationship between trainers and students.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (version 14.x or higher)
- [MongoDB](https://www.mongodb.com/) (local or cloud database)

### Clone the Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/yourusername/online-chess-school-backend.git
cd online-chess-school-backend

```

### Install Dependencies

```bash
npm install

```

### Configure Environment

```bash
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_key
PORT=3000
```

### Running the Project

```bash
npm run dev
```

### API

## Register

# URL: /api/auth/register

# Method: POST

# Body:

```bash
{
"firstName": "John",
"lastName": "Doe",
"email": "john.doe@example.com",
"password": "password123",
"role": "student"
}
```

## Login

# URL: /api/auth/login

# Method: POST

# Body:

```bash
{
"email": "john.doe@example.com",
"password": "password123"
}
```

# Response:

```bash
{
"token": "your_jwt_token"
}
```

## Assign Student to Trainer

# URL: /api/trainer/assign-student

# Method: POST

# Headers:

# Authorization: Bearer <your_jwt_token>

# Body

```bash
{
"trainerId": "trainer_id_here",
"studentId": "student_id_here"
}
```

## Get Trainer's Students

# URL: /api/trainer/:trainerId/students

# Method: GET

# Headers:

# Authorization: Bearer <your_jwt_token>

## Project Structure

# config/: Configuration files, including database connection settings.

# middleware/: Middleware functions, including authentication.

# models/: Mongoose models for database interaction.

# routes/: API route definitions.

# server.js: Main server file.

### Contributing

If you want to contribute to this project, please create a Pull Request or open an Issue.

### License

This project is licensed under the MIT License.

### Contact

If you have any questions or suggestions, feel free to reach out to me via email at: your.email@example.com.
This `README.md` provides a comprehensive guide to setting up, running, and using your project, as well as instructions for contributing and contacting you.
