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
    posts.length === 0 ? (
      <p className='text-center'>Loading...</p>
    ) : (
      <div className='flex flex-col items-center gap-4'>
        <h1 className='text-xl'>投稿一覧</h1>
        {error && <p className='text-red-400'>{error}</p>}
        <table>
          <thead>
            <tr>
              <th>Content</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {posts.map(post => (
              <tr key={post.id}>
                <td className='border'>{post.content}</td>
                <td className='border'>{post.file_url && <a href={post.file_url} target='_blank'>リンク</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

  );
}
