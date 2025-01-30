"use client"
import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { loginCognito } from '@/libs/cognitoClient';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    try {
      const idToken = await loginCognito(username, password);
      console.log('Logged in, got ID token:', idToken);
      localStorage.setItem('cognito-id-token', idToken);
      router.push('/');
    } catch (err) {
      // err は unknown 扱いになるので、型ガードを使ってメッセージを取得
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  }

  return (
    <div>
      <h1>Login</h1>
      <form onSubmit={handleLogin}>
        <label>
          Username:
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password:
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit">Login</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
