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
      <h1 className='text-xl'>Posts</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
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
              <td>{post.content}</td>
              <td>{post.file_url && <a href={post.file_url} target='_blank'>リンク</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
