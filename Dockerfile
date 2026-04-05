FROM node:20-alpine

# Установка pnpm и nodemon
RUN npm install -g pnpm nodemon

WORKDIR /app

# Копируем package файлы
COPY package.json pnpm-lock.yaml ./

# Устанавливаем зависимости
RUN pnpm install

# Копируем исходники
COPY . .

# Генерация Prisma (если используется)
RUN pnpm run prisma:generate 2>/dev/null || true

EXPOSE 8000

# Запуск с nodemon
CMD ["nodemon", "--watch", "src", "--ext", "ts", "--exec", "pnpm", "run", "start:dev"]