grab all the env variable names out of this docker compose snippet and give me a blank .env.example file with comments for each one:
services:
  api:
    image: node:20-alpine
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_HOST=${REDIS_HOST:-localhost}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}

Write the file to .env.example.
