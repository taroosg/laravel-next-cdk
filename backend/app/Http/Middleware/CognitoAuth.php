<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\Http;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

class CognitoAuth
{
  /**
   * Handle an incoming request.
   *
   * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
   */
  public function handle(Request $request, Closure $next): Response
  {
    // 1. Authorization ヘッダから "Bearer <token>" を取得
    $authorization = $request->header('Authorization', '');
    if (!str_starts_with($authorization, 'Bearer ')) {
      return response()->json(['error' => 'Token not provided'], 401);
    }
    $token = substr($authorization, 7);

    try {
      // 2. JWT ヘッダ部分をデコードして kid を取得
      list($headerEncoded,) = explode('.', $token, 2);
      $headerJson = base64_decode($headerEncoded);
      $header = json_decode($headerJson, true);
      $kid = $header['kid'] ?? null;
      if (!$kid) {
        throw new \Exception('No kid found in token header');
      }

      // 3. Cognito の JWKS (JSON Web Key Set) を取得
      $region = env('COGNITO_REGION');
      $userPoolId = env('COGNITO_USER_POOL_ID');
      $jwkUrl = "https://cognito-idp.{$region}.amazonaws.com/{$userPoolId}/.well-known/jwks.json";

      $response = Http::get($jwkUrl);
      if (!$response->ok()) {
        throw new \Exception('Failed to fetch JWKS from Cognito');
      }
      $jwks = $response->json()['keys'];

      // 4. kid に合致する公開鍵データを探す
      $publicKeyData = null;
      foreach ($jwks as $jwk) {
        if (isset($jwk['kid']) && $jwk['kid'] === $kid) {
          $publicKeyData = $jwk;
          break;
        }
      }
      if (!$publicKeyData) {
        throw new \Exception("Public key with kid={$kid} not found.");
      }

      // 5. JWKS の RSA 公開鍵情報 (n, e) を PEM 化
      $pem = $this->jwkToPem($publicKeyData);

      // 6. JWT をデコード & 検証（署名、exp、iat など）
      //    RS256 で検証する
      $decoded = JWT::decode($token, new Key($pem, 'RS256'));

      // 7. iss (発行者) / aud (クライアントID) / exp (有効期限) など追加チェック
      //    例:
      $expectedIss = "https://cognito-idp.{$region}.amazonaws.com/{$userPoolId}";
      if ($decoded->iss !== $expectedIss) {
        throw new \Exception('Invalid iss');
      }
      // if ($decoded->aud !== env('COGNITO_CLIENT_ID')) {
      //   throw new \Exception('Invalid aud');
      // }
      if ($decoded->exp < time()) {
        throw new \Exception('Token expired');
      }

      // ユーザが存在しない場合は、新規登録する
      $user = User::firstOrCreate([
        'cognito_sub' => $decoded->sub,
      ], [
        'cognito_sub' => $decoded->sub,
        'name' => $decoded->sub,
        'email' => $decoded->email,
      ]);

      // ユーザを認証済みとして扱う
      auth()->setUser($user);

      // 8. トークンからユーザ情報をリクエストにセット（任意）
      $request->attributes->set('cognito_decoded_token', $decoded);
    } catch (\Exception $e) {
      return response()->json([
        'error' => 'Unauthorized: ' . $e->getMessage()
      ], 401);
    }

    return $next($request);
  }

  /**
   * Cognito JWKS の (n, e) から PEM 形式の公開鍵文字列を生成
   */
  private function jwkToPem(array $jwk)
  {
    $n = $this->base64UrlDecode($jwk['n']);
    $e = $this->base64UrlDecode($jwk['e']);

    // バイナリ→16進変換
    $modulusHex = bin2hex($n);
    $exponentHex = bin2hex($e);

    // ASN.1 DER エンコード
    $modulusLen = strlen($modulusHex) / 2;
    $exponentLen = strlen($exponentHex) / 2;

    $encodedModulus = $this->encodeLength($modulusLen);
    $encodedExponent = $this->encodeLength($exponentLen);

    $part1 = '30' . $this->encodeLength(
      $modulusLen + $exponentLen
        + (strlen($encodedModulus) / 2)
        + (strlen($encodedExponent) / 2)
        + 2
    );
    $part2 = '02' . $encodedModulus . $modulusHex;
    $part3 = '02' . $encodedExponent . $exponentHex;
    $rsaHex = $part1 . $part2 . $part3;
    $rsa = base64_encode(hex2bin($rsaHex));

    $pem = "-----BEGIN RSA PUBLIC KEY-----\n"
      . chunk_split($rsa, 64, "\n")
      . "-----END RSA PUBLIC KEY-----\n";

    return $pem;
  }

  /**
   * Base64URL デコード (標準の base64 と異なる文字セットの対応)
   */
  private function base64UrlDecode($data)
  {
    $remainder = strlen($data) % 4;
    if ($remainder > 0) {
      $data .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($data, '-_', '+/'));
  }

  /**
   * DERエンコード用に長さをエンコードする
   */
  private function encodeLength($length)
  {
    if ($length <= 0x7F) {
      return sprintf("%02x", $length);
    } elseif ($length <= 0xFF) {
      return "81" . sprintf("%02x", $length);
    } else {
      return "82" . sprintf("%04x", $length);
    }
  }
}
