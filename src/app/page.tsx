"use client";

import { useState } from "react";
import {
  generateToxicWordPairs,
  type GenerateToxicWordPairsOutput,
} from "@/ai/flows/generate-toxic-word-pairs-flow";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LoaderCircle, Send, Shield, Sparkles, Swords } from "lucide-react";

export default function Home() {
  const [theme, setTheme] = useState("");
  const [result, setResult] = useState<GenerateToxicWordPairsOutput | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);
    try {
      const words = await generateToxicWordPairs({ theme });
      setResult(words);
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: "The AI is being toxic to us! Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4 sm:p-8">
      <div className="flex w-full max-w-3xl flex-col items-center gap-8">
        <header className="text-center">
          <h1 className="font-headline text-5xl font-bold tracking-tighter text-glow md:text-6xl">
            <span className="glitch-effect" data-text="DeepSpy">
              DeepSpy
            </span>
            <span className="text-primary">.</span>Bot
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Toxic Word Pair Generator
          </p>
        </header>

        <Card className="w-full border-primary/20 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="text-primary" />
              <span>Generate New Words</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="theme">Theme (Optional)</Label>
                <Input
                  id="theme"
                  type="text"
                  placeholder="e.g., animals, food, technology"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="bg-background/50 text-base"
                />
              </div>
              <Button type="submit" disabled={isLoading} size="lg">
                {isLoading ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles />
                    Generate
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {result && (
          <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="animate-in fade-in zoom-in-95 duration-500">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="font-headline text-2xl">
                  Civilian
                </CardTitle>
                <Shield className="h-8 w-8 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="font-headline text-4xl font-bold tracking-tight text-glow">
                  {result.civilianWord}
                </p>
              </CardContent>
            </Card>
            <Card className="animate-in fade-in zoom-in-95 duration-500 delay-100">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="font-headline text-2xl">
                  Undercover
                </CardTitle>
                <Swords className="h-8 w-8 text-accent" />
              </CardHeader>
              <CardContent>
                <p className="font-headline text-4xl font-bold tracking-tight text-glow">
                  {result.undercoverWord}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        
        <Card className="w-full animate-in fade-in zoom-in-95 duration-500 delay-200 border-accent/20 bg-card/80 shadow-lg shadow-accent/10 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="text-accent" />
              <span>Connect Your Telegram Bot</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>To use the DeepSpy bot in Telegram, you need to connect your bot to this running application.</p>
            <div className="space-y-2">
                <h3 className="font-semibold">Step 1: Get your Bot Token</h3>
                <p className="text-sm text-muted-foreground">
                    If you haven't already, talk to <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">@BotFather</a> on Telegram, create a new bot, and get your unique token. You should then add it to the <code>.env</code> file.
                </p>
            </div>
            <div className="space-y-2">
                <h3 className="font-semibold">Step 2: Set the Webhook</h3>
                <p className="text-sm text-muted-foreground">
                    You need to tell Telegram where to send messages. After deploying your app and getting a public URL, open your browser and go to the following URL. Make sure to replace the placeholders!
                </p>
                <pre className="mt-2 w-full overflow-x-auto rounded-md bg-background/50 p-4 text-sm">
                    <code>
                        https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/setWebhook?url=&lt;YOUR_APP_URL&gt;/api/webhook
                    </code>
                </pre>
                <p className="text-xs text-muted-foreground">
                    Replace <code>&lt;YOUR_BOT_TOKEN&gt;</code> with your token from BotFather.
                    <br/>
                    Replace <code>&lt;YOUR_APP_URL&gt;</code> with the public URL of this application.
                </p>
            </div>
             <p className="text-sm">{'Once you see `{"ok":true,"result":true,"description":"Webhook was set"}`, your bot is ready to be added to a group chat!'}</p>
          </CardContent>
        </Card>

      </div>
      <footer className="absolute bottom-4 text-center text-sm text-muted-foreground">
        <p>
          Press <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            <span className="text-xs">⌘</span>B
          </kbd> to toggle sidebar (if any).
        </p>
        <p>Built for the DeepSpy Telegram Bot.</p>
      </footer>
    </main>
  );
}
