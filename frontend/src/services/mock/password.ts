export const PASSWORD_EQUALS_LOGIN_ID_MESSAGE =
  "로그인 아이디와 같은 비밀번호는 사용할 수 없습니다.";

// ASCII-only fold, matching the backend rule (not toLowerCase, which folds non-ASCII).
const asciiLower = (value: string) =>
  value.replace(/[A-Z]/g, (char) => char.toLowerCase());

export function passwordEqualsLoginId(
  loginId: string,
  password: string,
): boolean {
  return (
    asciiLower(password.normalize("NFC")) ===
    asciiLower(loginId.trim().normalize("NFC"))
  );
}
