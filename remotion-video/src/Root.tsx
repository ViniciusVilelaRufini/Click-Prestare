import "./index.css";
import { Composition } from "remotion";
import { HelloWorld, myCompSchema } from "./HelloWorld";
import { Logo, myCompSchema2 } from "./HelloWorld/Logo";
import { PrestareVideo } from "./PrestareVideo";
import { ClickReels } from "./ClickReels";
import { FPS, HEIGHT, TIMELINE, TOTAL_DURATION, WIDTH } from "./ClickReels/lib/timeline";
import { SCENE_PREVIEWS } from "./ClickReels/previews";

// Each <Composition> is an entry in the sidebar!

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Reels / Shorts / TikTok — vídeo principal do app Click */}
      <Composition
        id="ClickReels"
        component={ClickReels}
        durationInFrames={TOTAL_DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* Uma composição por cena: permite iterar em 5s em vez de 48s */}
      {TIMELINE.map((scene) => (
        <Composition
          key={scene.id}
          id={`ClickReels-${scene.id}`}
          component={SCENE_PREVIEWS[scene.id]}
          durationInFrames={scene.duration}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      ))}

      <Composition
        id="PrestareVideo"
        component={PrestareVideo}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PrestareVideoReels"
        component={PrestareVideo}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
      />

      <Composition
        // You can take the "id" to render a video:
        // npx remotion render HelloWorld
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        // You can override these props for each render:
        // https://www.remotion.dev/docs/parametrized-rendering
        schema={myCompSchema}
        defaultProps={{
          titleText: "Welcome to Remotion",
          titleColor: "#000000",
          logoColor1: "#91EAE4",
          logoColor2: "#86A8E7",
        }}
      />

      {/* Mount any React component to make it show up in the sidebar and work on it individually! */}
      <Composition
        id="OnlyLogo"
        component={Logo}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={myCompSchema2}
        defaultProps={{
          logoColor1: "#91dAE2" as const,
          logoColor2: "#86A8E7" as const,
        }}
      />
    </>
  );
};

