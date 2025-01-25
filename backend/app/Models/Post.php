<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

class Post extends Model
{
  use HasUlids;
  protected $fillable = [
    'user_id',
    'content',
    'file_path',
  ];

  public function user()
  {
    return $this->belongsTo(User::class);
  }
}
