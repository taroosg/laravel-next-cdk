<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\PostController;

Route::get('/public', function () {
  return response()->json([
    'message' => 'This is public endpoint',
    'timestamp' => now(),
  ]);
});

Route::middleware('cognito.auth')->group(function () {
  // 保護されたGET
  Route::get('/protected', function (Request $request) {
    $decoded = $request->attributes->get('cognito_decoded_token');
    $user = auth()->user();

    return response()->json([
      'message' => 'You are authenticated!',
      'decoded_token' => $decoded,
      'user' => $user,
    ]);
  });

  Route::resource('posts', PostController::class)->only(['index', 'store']);
});
