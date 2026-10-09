import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthView } from "../src/features/auth/view-auth";
import { ServiceError } from "../src/services/service-error";

describe("API-mode auth availability", () => {
  it("keeps signup contact guidance without mock-only advice", () => {
    vi.stubGlobal("__DATA_MODE__", "api");
    try {
      const { container } = render(
        <MemoryRouter>
          <AuthView mode="signup" authStatus="ready" authUser={null} />
        </MemoryRouter>,
      );
      expect(
        screen.queryByText(/개발용|mock|가짜 비밀번호/),
      ).not.toBeInTheDocument();
      expect(container.querySelector("#contact-hint")).toHaveTextContent(
        "이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다. 실제 수집 기능은 비활성화되어 있습니다.",
      );
      for (const selector of ["#email", "#phone"]) {
        expect(container.querySelector(selector)).toHaveAttribute(
          "aria-describedby",
          "contact-hint",
        );
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains that authentication is unavailable without showing a form", () => {
    render(
      <MemoryRouter>
        <AuthView mode="login" authStatus="unavailable" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "인증 기능은 아직 준비 중이에요",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("login failure messages", () => {
  async function submitWith(error) {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthView
          mode="login"
          authStatus="ready"
          authUser={null}
          onLogin={() => Promise.reject(error)}
        />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("로그인 아이디"), "member-a");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
  }

  it.each([
    [
      new ServiceError("RATE_LIMITED", "x", {
        retryAt: "2026-10-01T00:15:00Z",
      }),
      /로그인 시도가 너무 많아요\. 9시 15분 이후에 다시 시도해 주세요\./,
    ],
    [
      new ServiceError("RATE_LIMITED", "x"),
      /로그인 시도가 너무 많아요\. 잠시 뒤에 다시 시도해 주세요\./,
    ],
    [
      new ServiceError("AUTH_STATE_CHANGED", "x"),
      /계정 상태가 바뀌었어요\. 다시 로그인해 주세요\./,
    ],
    [new ServiceError("AUTH_BUSY", "x"), /서버가 바빠요/],
    [new ServiceError("DB_BUSY", "x"), /서버가 바빠요/],
    [new ServiceError("NETWORK_ERROR", "x"), /로그인하지 못했어요/],
    [
      new ServiceError("FORBIDDEN", "관리자 권한이 필요해요."),
      /관리자 권한이 필요해요/,
    ],
    [
      new ServiceError("FORBIDDEN", "이 작업을 수행할 권한이 없어요."),
      "이 작업을 수행할 권한이 없어요.",
    ],
  ])("tells %s apart from a credential error", async (error, expected) => {
    await submitWith(error);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });
});

it("announces initial pending retention before a registration request", () => {
  render(
    <MemoryRouter>
      <AuthView mode="signup" authStatus="ready" authUser={null} />
    </MemoryRouter>,
  );
  expect(
    screen.getByText(/최초 승인 없이 가입일부터 90일이 지나면/),
  ).toHaveTextContent("자동 삭제");
});

it("announces the registration retry time from the server rolling limit", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AuthView
        mode="signup"
        authStatus="ready"
        authUser={null}
        onRegister={() =>
          Promise.reject(
            new ServiceError("RATE_LIMITED", "x", {
              retryAt: "2026-10-01T00:15:00Z",
            }),
          )
        }
      />
    </MemoryRouter>,
  );
  await user.type(screen.getByLabelText("로그인 아이디 (필수)"), "teacher");
  await user.type(
    screen.getByLabelText("비밀번호 (필수)"),
    "synthetic password",
  );
  await user.type(
    screen.getByLabelText("비밀번호 확인 (필수)"),
    "synthetic password",
  );
  await user.type(screen.getByLabelText("별명 (필수)"), "교사");
  await user.click(screen.getByRole("button", { name: "가입 신청하기" }));
  expect(
    await screen.findByText(
      "가입 시도가 너무 많아요. 9시 15분 이후에 다시 시도해 주세요.",
    ),
  ).toBeInTheDocument();
});

it("offers the existing missing-session discard action on the reauthentication card", () => {
  render(
    <MemoryRouter>
      <AuthView
        mode="reauth"
        authStatus="unresolved"
        authUser={null}
        canDiscardMissingSession={true}
        onDiscardMissingSession={() => {}}
      />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("button", { name: "받지 못한 세션 버리기" }),
  ).toBeVisible();
});

const configuredSupport = {
  email: "support+archive@example.test",
  service_url: "https://service.example.test/help",
  announcement_url: "https://notice.example.test/updates",
};

function expectSupportLinks() {
  expect(screen.getByRole("link", { name: "이메일 문의" })).toHaveAttribute(
    "href",
    "mailto:support+archive@example.test",
  );
  expect(screen.getByRole("link", { name: "서비스 문의" })).toHaveAttribute(
    "href",
    "https://service.example.test/help",
  );
  expect(screen.getByRole("link", { name: "공지사항" })).toHaveAttribute(
    "href",
    "https://notice.example.test/updates",
  );
}

describe("support notices", () => {
  it.each([
    ["login", "ready"],
    ["signup", "ready"],
    ["login", "unavailable"],
  ])("renders configured support in %s/%s", (mode, authStatus) => {
    render(
      <MemoryRouter>
        <AuthView
          mode={mode}
          authStatus={authStatus}
          support={configuredSupport}
        />
      </MemoryRouter>,
    );
    expectSupportLinks();
  });

  it("renders support in the pending notice without claiming contact is unset", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthView
          mode="signup"
          authStatus="ready"
          support={configuredSupport}
          onRegister={async () => ({
            pendingExpiresAt: "2026-12-21T00:00:00Z",
          })}
        />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/^로그인 아이디/), "support-teacher");
    await user.type(
      screen.getByLabelText(/^비밀번호 \(필수\)$/),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText(/^비밀번호 확인/),
      "correct horse battery staple",
    );
    await user.type(screen.getByLabelText(/^별명/), "교사");
    await user.click(screen.getByRole("button", { name: "가입 신청하기" }));
    await screen.findByRole("heading", { name: "가입 신청이 접수되었어요" });
    expectSupportLinks();
    expect(screen.queryByText(/운영 문의 주소는 현재/)).not.toBeInTheDocument();
  });

  it("renders no support anchors for unset metadata", () => {
    render(
      <MemoryRouter>
        <AuthView
          mode="signup"
          authStatus="ready"
          support={{ email: null, service_url: null, announcement_url: null }}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("link", { name: /이메일 문의|서비스 문의|공지사항/ }),
    ).not.toBeInTheDocument();
  });
});

describe("safe support rendering", () => {
  it.each([
    { email: "support@example.test?subject=unsafe" },
    { email: "name <support@example.test>" },
    { email: "a..b@example.test" },
    { email: "a%0a@example.test" },
    { email: "a#b@example.test" },
    {
      service_url: "javascript:alert(1)",
      announcement_url: "data:text/html,x",
    },
    {
      service_url: "http://service.example.test/help",
      announcement_url: "mailto:a@example.test",
    },
    { service_url: "/help", announcement_url: "https://[" },
  ])("omits unsafe support hrefs: %j", (support) => {
    render(
      <MemoryRouter>
        <AuthView mode="login" authStatus="unavailable" support={support} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

it("support links keep keyboard order and signup field error associations", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AuthView mode="signup" authStatus="ready" support={configuredSupport} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "가입 신청하기" }));
  expect(screen.getByLabelText(/^비밀번호 확인/)).toHaveAttribute(
    "aria-describedby",
    "password-confirm-error",
  );
  expect(screen.getByLabelText(/^이메일/)).toHaveAttribute(
    "aria-describedby",
    "contact-hint",
  );
  screen.getByRole("link", { name: "이메일 문의" }).focus();
  await user.tab();
  expect(screen.getByRole("link", { name: "서비스 문의" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("link", { name: "공지사항" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("link", { name: "서비스 문의" })).toHaveFocus();
});

it.each([
  { announcement_url: "https://notice.example.test/updates" },
  {
    email: "invalid",
    service_url: "javascript:alert(1)",
    announcement_url: "https://notice.example.test/updates",
  },
])(
  "announcement-only support preserves the pending contact-unset notice",
  async (support) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthView
          mode="signup"
          authStatus="ready"
          support={support}
          onRegister={async () => ({
            pendingExpiresAt: "2026-12-21T00:00:00Z",
          })}
        />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/^로그인 아이디/), "support-teacher");
    await user.type(
      screen.getByLabelText(/^비밀번호 \(필수\)$/),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByLabelText(/^비밀번호 확인/),
      "correct horse battery staple",
    );
    await user.type(screen.getByLabelText(/^별명/), "교사");
    await user.click(screen.getByRole("button", { name: "가입 신청하기" }));
    await screen.findByRole("heading", { name: "가입 신청이 접수되었어요" });
    expect(
      screen.getByText(/운영 문의 주소는 현재 설정되지/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공지사항" })).toHaveAttribute(
      "href",
      "https://notice.example.test/updates",
    );
    expect(
      screen.queryByRole("link", { name: "이메일 문의" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "서비스 문의" }),
    ).not.toBeInTheDocument();
  },
);

it("rejects a support email with a trailing newline", () => {
  render(
    <MemoryRouter>
      <AuthView
        mode="login"
        authStatus="unavailable"
        support={{ email: "support@example.test\n" }}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
