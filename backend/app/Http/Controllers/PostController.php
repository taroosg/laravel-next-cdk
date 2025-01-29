<?php

namespace App\Http\Controllers;

use App\Models\Post;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Mail;

class PostController extends Controller
{
  /**
   * Display a listing of the resource.
   */
  public function index()
  {
    $posts = Post::with('user')
      ->latest()
      ->get()
      ->map(function ($post) {
        $temporaryUrl = Storage::disk('s3')->temporaryUrl($post->file_path, now()->addMinutes(15));
        $post->file_url = $temporaryUrl;
        return $post;
      });
    return response()->json($posts);
  }

  /**
   * Show the form for creating a new resource.
   */
  public function create()
  {
    //
  }

  /**
   * Store a newly created resource in storage.
   */
  public function store(Request $request)
  {
    $request->validate([
      'content' => 'required|string|max:255',
      'file' => 'required|file',
    ]);

    $user = auth()->user();
    if (!$user) {
      return response()->json(['error' => 'Unauthorized'], 401);
    }

    // ファイルをアップロード
    $filePath = $request->file('file')->store('uploads', 's3');

    if (!$filePath) {
      return response()->json(['error' => 'Failed to upload file'], 500);
    }

    // フルパス使用する場合
    // $fileUrl = Storage::disk('s3')->url($path);

    $post = Post::create([
      'user_id' => $user->id,
      'content' => $request->content,
      'file_path' => $filePath,
    ]);

    $temporaryUrl = Storage::disk('s3')->temporaryUrl($filePath, now()->addMinutes(15));

    $post->file_url = $temporaryUrl;

    // メール送信（テスト用）
    Mail::raw('This is a test email sent via AWS SES!', function ($message) {
      $message
        ->to('noreply@mofneko.com')
        ->subject('Hello from Laravel + SES');
    });

    return response()->json([
      'message' => 'Post created successfully',
      'post' => $post,
    ], 201);
  }

  /**
   * Display the specified resource.
   */
  public function show(Post $post)
  {
    //
  }

  /**
   * Show the form for editing the specified resource.
   */
  public function edit(Post $post)
  {
    //
  }

  /**
   * Update the specified resource in storage.
   */
  public function update(Request $request, Post $post)
  {
    //
  }

  /**
   * Remove the specified resource from storage.
   */
  public function destroy(Post $post)
  {
    //
  }
}
