'use client';

import React from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';

export default function LogoutButton() {
  const { signOut } = useAuthenticator((context) => [context.user]);

  return (
    <button onClick={signOut} className="ml-auto">
      Logout
    </button>
  );
}
