'use client';

import React, { useEffect, useState } from 'react';
import { getPosts, Post } from '@/libs/apiClient';

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getPosts()
      .then(data => setPosts(data))
      .catch(err => {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(String(err));
        }
      });
  }, []);

  return (
    <div>
      <h1>Posts</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ul>
        {posts.map(post => (
          <li key={post.id}>
            <p>{post.content}</p>
            {post.file_url && <img src={post.file_url} alt="file" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
