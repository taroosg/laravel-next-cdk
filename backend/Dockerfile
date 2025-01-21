# backend/Dockerfile
FROM php:8.4

RUN apt-get update && apt-get install -y \
  zip \
  unzip \
  libpq-dev \
  libzip-dev \
  libonig-dev \
  && docker-php-ext-install pdo_mysql mbstring zip

COPY --from=composer:2.8 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

COPY . /var/www

RUN composer install

# php artisan serve --host=0.0.0.0で起動
CMD ["php", "artisan", "serve", "--host=0.0.0.0"]
