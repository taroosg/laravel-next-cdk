<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
  return $request->user();
})->middleware('auth:sanctum');

Route::get('/public', function () {
  return response()->json([
    'message' => 'This is public endpoint',
    'timestamp' => now(),
  ]);
});

Route::middleware('cognito.auth')->group(function () {
  // 保護されたGET
  Route::get('/protected', function (Request $request) {
    // ミドルウェアでトークン検証済み
    $decoded = $request->attributes->get('cognito_decoded_token');
    return response()->json([
      'message' => 'You are authenticated!',
      'decoded_token' => $decoded,
    ]);
  });

  // 簡単なPOST例 (DBに保存など)
  // Route::post('/posts', function (Request $request) {
  //   $decoded = $request->attributes->get('cognito_decoded_token');
  //   // 例: $decoded->sub とかを使って何かデータを作成
  //   // ...
  //   return response()->json(['result' => 'Created something.']);
  // });
});
