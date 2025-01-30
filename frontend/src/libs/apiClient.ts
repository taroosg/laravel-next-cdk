export async function getPosts(idToken: string): Promise<Post[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/posts`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch posts: ${res.status}`);
  }
  return res.json();
}

// テキスト + ファイル投稿
// file には通常、<input type="file"> で取得した File を渡す
export async function createPost(idToken: string, content: string, file: File) {
  const formData = new FormData();
  formData.append('content', content);
    formData.append('file', file);

  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
    },
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`Failed to create post: ${res.status}`);
  }
  return res.json();
}

export type Post = {
  id: string;
  content: string;
  file_path?: string;
  created_at: string;
  updated_at: string;
  file_url: string;
  user: User;
};

export type User = {
  id: string;
  cognito_sub: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}
