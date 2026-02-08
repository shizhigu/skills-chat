import { Header } from "~/components/layout/header";
import { Main } from "~/components/layout/main";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Separator } from "~/components/ui/separator";

export default function Settings() {
  return (
    <>
      <Header title="设置" />
      <Main className="p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">设置</h2>
          <p className="text-muted-foreground">管理你的账户和偏好设置</p>
        </div>

        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>外观</CardTitle>
              <CardDescription>自定义应用外观</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="dark-mode">深色模式</Label>
                <Switch id="dark-mode" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>对话</CardTitle>
              <CardDescription>对话相关设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="send-enter">Enter 发送</Label>
                  <p className="text-xs text-muted-foreground">
                    按 Enter 发送消息，Shift+Enter 换行
                  </p>
                </div>
                <Switch id="send-enter" defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="show-tokens">显示 Token 用量</Label>
                  <p className="text-xs text-muted-foreground">
                    在每条消息下方显示 token 用量
                  </p>
                </div>
                <Switch id="show-tokens" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API 密钥</CardTitle>
              <CardDescription>
                使用自己的 API Key 可以解锁更多用量
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                即将推出...
              </p>
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  );
}
