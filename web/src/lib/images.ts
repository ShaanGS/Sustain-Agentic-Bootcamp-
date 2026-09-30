// Editorial images generated on Magnific for Still.
// `npm run images` downloads them into web/public/img/ so the app works offline.
// Until then the <Photo> component falls back to the Magnific URL, then to a tinted placeholder.
export interface ImageDef { file: string; remote: string; tint: string; alt: string }

export const IMAGES = {
  student: {
    file: "student.jpg", tint: "#E9D9C4", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589622473/render.jpg?token=exp=1791072000~hmac=bf188f0a29c2035ab7f4952bd6eada6df49dcb234fae0ff821e3003cf177d27b",
  },
  shelf: {
    file: "shelf.png", tint: "#EFE6DA", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589623660/render.png?token=exp=1791072000~hmac=972dccf1a23a553b1a2c0b21281c3f19bd5b18d6b1e98d5d971cfa9c4111653f",
  },
  PRIORITIZE: {
    file: "skill-prioritize.png", tint: "#E8DCC8", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589625682/render.png?token=exp=1791072000~hmac=482b4adfd4194dafc368c4ea723f7f26a6aaec780f067334482f9f7fd54dca0f",
  },
  START_SMALL: {
    file: "skill-ten-minute-start.png", tint: "#ECE3D6", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589626956/render.png?token=exp=1791072000~hmac=9bb9f230a38cb17ff2c5b791dd8662669add45143fb4d8784bc5507e7baeeca2",
  },
  PACED_BREATHING: {
    file: "skill-paced-breathing.png", tint: "#F1E1CF", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589627200/render.png?token=exp=1791072000~hmac=eaa9b5c8118d3086a13ecb1f3e9f16f531f6eeb6df734baeb8655bcbdeff2b97",
  },
  REACH_OUT: {
    file: "skill-reach-out.png", tint: "#E6CFBE", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589627761/render.png?token=exp=1791072000~hmac=6a8e55a274bfdd55cb7e162cda8308220115978c399e24e1b10d655a4d053a90",
  },
  WIND_DOWN: {
    file: "skill-wind-down.png", tint: "#D9C6AE", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589627268/render.png?token=exp=1791072000~hmac=dd0fc8b6da4bd8b5470920d5fe604974e82f9db43b4d043a7d93d4696378176a",
  },
  CLOSE_OK: {
    file: "skill-close-ok.png", tint: "#F3EADF", alt: "",
    remote: "https://pikaso.cdnpk.net/private/production/5589627447/render.png?token=exp=1791072000~hmac=9b2cc220340656af3de839f17d4d629f1cdb2ecb4829503d5702196de42941a0",
  },
} satisfies Record<string, ImageDef>;

export type ImageName = keyof typeof IMAGES;
