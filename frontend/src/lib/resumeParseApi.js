import { authJson } from './authFetch';

export async function parseResumeFile(file) {
  if (!file) throw new Error('Choose a resume file first.');

  const dataBase64 = await fileToBase64(file);
  return authJson('/api/team/parse-resume', {
    method: 'POST',
    body: {
      filename: file.name,
      contentType: file.type,
      dataBase64,
    },
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read resume file.'));
    reader.readAsDataURL(file);
  });
}
