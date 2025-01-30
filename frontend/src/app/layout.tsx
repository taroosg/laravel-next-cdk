'use client';
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import '@/libs/amplifyClient';
import '@aws-amplify/ui-react/styles.css';
import {
  Authenticator,
} from "@aws-amplify/ui-react";
import LogoutButton from '@/components/LogoutButton';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Authenticator signUpAttributes={[]} loginMechanisms={['email']} hideSignUp>
          <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem' }}>
            <LogoutButton />
          </header>
          {children}
        </Authenticator>
      </body>
    </html>
  );
}
