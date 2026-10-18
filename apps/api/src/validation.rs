use crate::{
    error::{ApiError, ApiResult},
    model::{Meaning, SaveWordRequest, SentenceInput},
};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

pub fn text(value: &str) -> ApiResult<()> {
    if value.trim().is_empty() || value.chars().count() > 200 {
        return Err(ApiError::bad(
            "Word or phrase must contain 1–200 characters.",
        ));
    }
    Ok(())
}
pub fn meanings(values: &[Meaning]) -> ApiResult<()> {
    if values.is_empty() || values.len() > 30 {
        return Err(ApiError::bad("Provide between 1 and 30 meanings."));
    }
    for meaning in values {
        if meaning.part_of_speech.trim().is_empty()
            || meaning.part_of_speech.chars().count() > 100
            || meaning.definition.trim().is_empty()
            || meaning.definition.chars().count() > 3000
        {
            return Err(ApiError::bad("Each meaning needs a part of speech (up to 100 characters) and a definition (up to 3000 characters)."));
        }
    }
    Ok(())
}
pub fn utf16_byte_index(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units == offset {
            return Some(byte);
        }
        units += ch.len_utf16();
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(text.len())
}
pub fn sentence(input: &SentenceInput) -> ApiResult<()> {
    if input.text.trim().is_empty()
        || input.text.chars().count() > 5000
        || input.source.chars().count() > 2000
    {
        return Err(ApiError::bad(
            "Sentences must contain 1–5000 characters; sources may contain up to 2000.",
        ));
    }
    let start = utf16_byte_index(&input.text, input.target_start)
        .ok_or_else(|| ApiError::bad("Sentence targetStart is not a Unicode boundary."))?;
    let end = utf16_byte_index(&input.text, input.target_end)
        .ok_or_else(|| ApiError::bad("Sentence targetEnd is not a Unicode boundary."))?;
    if start >= end || input.text[start..end].trim().is_empty() {
        return Err(ApiError::bad(
            "Select a nonempty target word or phrase in each sentence.",
        ));
    }
    Ok(())
}
pub fn save(input: &SaveWordRequest) -> ApiResult<()> {
    text(&input.text)?;
    meanings(&input.meanings)?;
    if input.sentences.len() > 100 {
        return Err(ApiError::bad("A word may have at most 100 sentences."));
    }
    for value in &input.sentences {
        sentence(value)?;
    }
    let bytes = input.text.len()
        + input
            .meanings
            .iter()
            .map(|meaning| meaning.part_of_speech.len() + meaning.definition.len())
            .sum::<usize>()
        + input
            .sentences
            .iter()
            .map(|sentence| sentence.text.len() + sentence.source.len())
            .sum::<usize>();
    if bytes > 200_000 {
        return Err(ApiError::bad(
            "A word entry may contain at most 200 KB of text.",
        ));
    }
    Ok(())
}
pub fn identity(text: &str) -> String {
    text.nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub fn name_key(text: &str) -> String {
    format!(
        "NAME#{}",
        hex::encode(Sha256::digest(identity(text).as_bytes()))
    )
}
pub fn identifier(value: &str) -> ApiResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'-' | b'_' | b'.'))
    {
        return Err(ApiError::bad("Invalid identifier."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Origin;
    #[test]
    fn utf16_offsets_preserve_exact_occurrence_and_reject_half_surrogates() {
        let value = SentenceInput {
            text: "😀 go, go!".into(),
            target_start: 7,
            target_end: 9,
            origin: Origin::Encountered,
            source: String::new(),
        };
        assert!(sentence(&value).is_ok());
        assert_eq!(
            &value.text[utf16_byte_index(&value.text, 7).unwrap()
                ..utf16_byte_index(&value.text, 9).unwrap()],
            "go"
        );
        assert!(utf16_byte_index(&value.text, 1).is_none());
        assert!(utf16_byte_index(&value.text, 99).is_none());
    }
    #[test]
    fn duplicate_identity_is_normalized_without_rewriting_display() {
        assert_eq!(name_key("  TAKE\tOff "), name_key("take off"));
        assert_eq!(name_key("Ｈｅｌｌｏ"), name_key("hello"));
    }
}
