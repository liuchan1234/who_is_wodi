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
import { LoaderCircle, Shield, Sparkles, Swords } from "lucide-react";

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
