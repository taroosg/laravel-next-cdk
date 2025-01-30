import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails
} from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID!,
};

const userPool = new CognitoUserPool(poolData);

// ログイン関数
export async function loginCognito(email: string, password: string) {
  return new Promise<string>((resolve, reject) => {
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const idToken = session.getIdToken().getJwtToken();
        resolve(idToken);
      },
      onFailure: (err) => {
        reject(err);
      }
    });
  });
}

// ログアウト関数
export function logoutCognito() {
  const currentUser = userPool.getCurrentUser();
  if (currentUser) {
    currentUser.signOut();
  }
}

// 現在のユーザ情報やトークン取得
export function getCurrentIdToken(): string | null {
  const currentUser = userPool.getCurrentUser();
  if (!currentUser) return null;

  const session = currentUser.getSignInUserSession();
  if (!session) return null;

  return session.getIdToken().getJwtToken();
}
