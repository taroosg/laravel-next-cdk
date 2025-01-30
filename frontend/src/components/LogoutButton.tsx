import React from 'react';
import { logoutCognito } from '@/libs/cognitoClient';
import { useRouter } from 'next/router';

export default function LogoutButton() {
  const router = useRouter();
  const handleLogout = () => {
    logoutCognito();
    localStorage.removeItem('cognito-id-token');
    router.push('/login');
  };

  return <button onClick={handleLogout}>Logout</button>;
}
