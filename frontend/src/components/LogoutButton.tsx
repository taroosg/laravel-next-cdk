'use client';

import React from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';

export default function LogoutButton() {
  const { signOut } = useAuthenticator((context) => [context.user]);

  return (
    <button onClick={signOut} style={{ margin: '0 1rem' }}>
      Logout
    </button>
  );
}
