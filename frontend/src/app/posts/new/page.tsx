'use client';

import React, { useState } from 'react';
import { createPost } from '@/libs/apiClient';
import { useRouter } from 'next/navigation';

export default function NewPostPage() {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    setSending(true);
    e.preventDefault();
    setError('');
    try {
      await createPost(text, file!);
      router.push('/posts');
    } catch (err) {
      setSending(false);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  }

  return (
    sending ? <p className='text-center'>Sending...</p> :
      <div className='flex flex-col items-center gap-4'>
        <h1 className='text-xl'>新規投稿</h1>
        <form onSubmit={handleSubmit} className='flex flex-col gap-4 items-start'>
          <label>テキスト:
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className='border p-2 text-black'
            />
          </label>
          <label>ファイル:
            <input
              type="file"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setFile(e.target.files[0]);
                }
              }}
            />
          </label>
          <button type="submit" className='border p-2'>Submit</button>
        </form>
        {error && <p className='text-color-400'>{error}</p>}
      </div>
  );
}
