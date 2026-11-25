"use client";

import { useActionState } from "react";
import { saveAiConfigAction, type AiConfigState } from "./actions";

type Props = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  keyTail: string | null;
  serverConfigured: boolean;
};

export function AiConfigCard({ configured, baseUrl, model, keyTail, serverConfigured }: Props) {
  const [state, formAction, pending] = useActionState<AiConfigState, FormData>(
    saveAiConfigAction,
    null,
  );
  const ok = state && "ok" in state ? state.ok : null;
  const error = state && "error" in state ? state.error : null;

  return (
    <section className="ac-card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">AI 助手模型</h2>
        <span className="text-xs text-ink-faint">自带 Key（BYOK）· 仅本人生效</span>
      </div>

      <p className="text-sm text-ink-soft">
        填写任意 <span className="font-medium">OpenAI 兼容接口</span> 的 API Key、服务地址与模型名，
        项目里的 AI 助手就用它来拆任务、答进度。不绑定具体厂商：DeepSeek、通义千问、豆包、月之暗面、
        OpenAI 都可以。
      </p>

      {configured ? (
        <p className="text-sm text-ink">
          已配置：
          <span className="font-medium">{model ?? "未填模型名"}</span>
          {" · "}
          <span className="text-ink-soft">{baseUrl ?? "未填服务地址"}</span>
          {keyTail && <span className="text-ink-faint">（Key 尾号 ····{keyTail}）</span>}
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          未配置个人 Key——
          {serverConfigured
            ? "当前使用服务器统一配置的模型。"
            : "服务器也没有统一配置，填写后才能使用 AI 助手。"}
        </p>
      )}

      <form action={formAction} className="space-y-3">
        <div>
          <label className="ac-label" htmlFor="ai-key">
            API Key
          </label>
          <input
            id="ai-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={configured ? "留空 = 保持原 Key" : "sk-…"}
            className="ac-field"
            maxLength={256}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="ac-label" htmlFor="ai-base-url">
              服务地址
            </label>
            <input
              id="ai-base-url"
              name="baseUrl"
              placeholder="https://api.deepseek.com/v1"
              className="ac-field"
              maxLength={256}
            />
          </div>
          <div>
            <label className="ac-label" htmlFor="ai-model">
              模型名
            </label>
            <input
              id="ai-model"
              name="model"
              placeholder="deepseek-flash / qwen-plus / moonshot-v1-8k"
              className="ac-field"
              maxLength={128}
            />
          </div>
        </div>

        <p className="text-xs text-ink-faint">
          留空字段保持原值；服务地址与模型名不确定时填写留空、沿用服务器配置。
          Key 加密存储，不会明文落库。
        </p>

        <div className="flex gap-2">
          <button disabled={pending} className="ac-btn whitespace-nowrap">
            {pending ? "保存中…" : "保存"}
          </button>
        </div>
        {ok && <p className="text-sm text-done">{ok}</p>}
        {error && <p className="text-sm text-high">{error}</p>}
      </form>

      {configured && (
        <form action={formAction} className="border-t border-line pt-3">
          <input type="hidden" name="clear" value="1" />
          <button disabled={pending} className="ac-btn-ghost text-high hover:border-high hover:text-high">
            清除个人配置（改用服务器配置）
          </button>
        </form>
      )}
    </section>
  );
}
