<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
  return response()->json([
    'message' => 'This is public endpoint',
    'timestamp' => now(),
  ]);
});

Route::get('/hoge', function () {
  return 'hoge';
});
